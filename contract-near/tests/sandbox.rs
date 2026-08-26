//! The half `tests/policy.rs` cannot reach: the cross-contract `ft_transfer` and
//! its rollback callback.
//!
//! The mocked VM has no second contract, so until now `on_paid` had no test at
//! all — and it is the only place that can corrupt the ledger. A transfer that
//! fails after `consume()` has already debited the grant would leave a developer
//! paying for something the merchant never received, permanently.
//!
//! Requires both wasm files. Run through `npm run near:test`, which builds them.

use near_workspaces::types::{NearToken, SecretKey};
use near_workspaces::network::Sandbox;
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const STORAGE: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
const USDC: u128 = 1_000_000;
const DAY_NS: u64 = 86_400_000_000_000;

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("target/wasm32-unknown-unknown/release/{name}.wasm");
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path} — run `npm run near:build` first"))
}

struct World {
    token: Contract,
    gm: Contract,
    sponsor: Account,
    dev: Account,
    merchant: Account,
    agent_key: SecretKey,
}

async fn register(token: &Contract, who: &Account, payer: &Account) -> anyhow::Result<()> {
    payer
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": who.id(), "registration_only": true }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn balance(token: &Contract, who: &str) -> anyhow::Result<u128> {
    let v: serde_json::Value = token
        .view("ft_balance_of")
        .args_json(json!({ "account_id": who }))
        .await?
        .json()?;
    Ok(v.as_str().unwrap().parse()?)
}

async fn setup(worker: &Worker<Sandbox>) -> anyhow::Result<World> {
    let token = worker.dev_deploy(&wasm("mock_ft")).await?;
    token.call("new").args_json(json!({ "decimals": 6 })).transact().await?.into_result()?;

    let gm = worker.dev_deploy(&wasm("grant_manager")).await?;
    gm.call("new").transact().await?.into_result()?;

    let root = worker.root_account()?;
    let sponsor = root.create_subaccount("sponsor").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let dev = root.create_subaccount("dev").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let merchant = root.create_subaccount("merchant").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;

    for who in [&sponsor, &merchant] {
        register(&token, who, &sponsor).await?;
    }
    // The contract holds the campaign's tokens, so it needs an account on the
    // token too. Forgetting this makes funding fail, not spending.
    sponsor
        .call(token.id(), "storage_deposit")
        .args_json(json!({ "account_id": gm.id(), "registration_only": true }))
        .deposit(STORAGE)
        .transact()
        .await?
        .into_result()?;

    sponsor
        .call(token.id(), "mint")
        .args_json(json!({ "account_id": sponsor.id(), "amount": (1000 * USDC).to_string() }))
        .transact()
        .await?
        .into_result()?;

    Ok(World { token, gm, sponsor, dev, merchant, agent_key: SecretKey::from_random(near_workspaces::types::KeyType::ED25519) })
}

fn campaign(token: &str, merchants: Vec<&str>) -> serde_json::Value {
    json!({
        "sponsor": "ignored.near", "token_id": token, "merchants": merchants,
        "funded": "0", "committed": "0",
        "grant_amount": (50 * USDC).to_string(), "tranche_count": 10,
        "tranche_period_ns": DAY_NS.to_string(), "min_spend_per_tranche": (2 * USDC).to_string(),
        "grant_validity_ns": (30 * DAY_NS).to_string(),
        "per_tx_cap": (2 * USDC).to_string(), "daily_cap": (4 * USDC).to_string(),
        "key_allowance": NearToken::from_near(2).as_yoctonear().to_string(),
        "paused": false,
    })
}

/// Campaign created, funded through `ft_transfer_call`, merchant approved, grant
/// claimed. Everything after this is about what happens when a payment moves.
async fn ready(w: &World) -> anyhow::Result<()> {
    w.sponsor
        .call(w.gm.id(), "create_campaign")
        .args_json(json!({ "id": "acme", "campaign": campaign(w.token.id().as_str(), vec![]) }))
        .transact()
        .await?
        .into_result()?;

    w.sponsor
        .call(w.token.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": w.gm.id(), "amount": (500 * USDC).to_string(), "msg": "acme" }))
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    w.sponsor
        .call(w.gm.id(), "set_merchants")
        .args_json(json!({ "id": "acme", "merchants": [w.merchant.id()] }))
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    w.dev
        .call(w.gm.id(), "claim_grant")
        .args_json(json!({
            "campaign_id": "acme", "repo": "github.com/dev/repo",
            "agent_pk": w.agent_key.public_key().to_string(),
        }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

/// The agent: it signs *as the contract account*, with the function-call access
/// key the contract issued to it. That is the whole access-key design in one line.
fn agent(w: &World, worker: &Worker<Sandbox>) -> Account {
    Account::from_secret_key(w.gm.id().clone(), w.agent_key.clone(), worker)
}

/// What the agent attaches to `pay_merchant`.
///
/// Deliberately **not** `max_gas()`. A function-call access key is charged the
/// *prepaid* gas, not what the call burns, so attaching 300 Tgas bills the
/// allowance ~1 NEAR for a call that costs a fraction of that. Over-attaching
/// gas here does not waste gas — it drains the key.
const AGENT_GAS: near_workspaces::types::Gas = near_workspaces::types::Gas::from_tgas(100);

async fn grant_spent(w: &World) -> anyhow::Result<(u128, u128)> {
    let g: serde_json::Value = w.gm.view("get_grant").args_json(json!({ "grant_id": "1" })).await?.json()?;
    Ok((
        g["spent"].as_str().unwrap().parse()?,
        g["spent_today"].as_str().unwrap().parse()?,
    ))
}

#[tokio::test]
async fn funding_claiming_and_paying_move_real_tokens() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = setup(&worker).await?;
    ready(&w).await?;

    assert_eq!(balance(&w.token, w.gm.id().as_str()).await?, 500 * USDC, "campaign holds the funds");

    let before = balance(&w.token, w.merchant.id().as_str()).await?;
    let out = agent(&w, &worker)
        .call(w.gm.id(), "pay_merchant")
        .args_json(json!({ "to": w.merchant.id(), "amount": USDC.to_string(), "memo": "test" }))
        .gas(AGENT_GAS)
        .transact()
        .await?
        .into_result()?;
    assert_eq!(out.json::<bool>()?, true, "settlement reported success");

    assert_eq!(balance(&w.token, w.merchant.id().as_str()).await? - before, USDC, "merchant was paid");
    assert_eq!(grant_spent(&w).await?, (USDC, USDC), "ledger recorded the spend");
    Ok(())
}

/// 🔴 The rollback. A merchant taken off the token after being allowlisted makes
/// `ft_transfer` panic *after* the grant has already been debited. Without the
/// callback the developer's cap is burned for a payment nobody received.
#[tokio::test]
async fn a_failed_transfer_gives_the_budget_back() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = setup(&worker).await?;
    ready(&w).await?;

    // One good payment first, so the assertion is about a *delta*, not zero.
    agent(&w, &worker)
        .call(w.gm.id(), "pay_merchant")
        .args_json(json!({ "to": w.merchant.id(), "amount": USDC.to_string(), "memo": "ok" }))
        .gas(AGENT_GAS)
        .transact()
        .await?
        .into_result()?;
    let (spent_before, today_before) = grant_spent(&w).await?;

    w.sponsor
        .call(w.token.id(), "storage_unregister")
        .args_json(json!({ "account_id": w.merchant.id() }))
        .transact()
        .await?
        .into_result()?;

    let out = agent(&w, &worker)
        .call(w.gm.id(), "pay_merchant")
        .args_json(json!({ "to": w.merchant.id(), "amount": USDC.to_string(), "memo": "doomed" }))
        .gas(AGENT_GAS)
        .transact()
        .await?;
    // The outer call succeeds — the transfer is a separate receipt that failed.
    // What matters is that the callback noticed and undid the debit.
    assert_eq!(out.into_result()?.json::<bool>()?, false, "settlement reported failure");

    assert_eq!(
        grant_spent(&w).await?,
        (spent_before, today_before),
        "a failed transfer must leave the ledger exactly where it was",
    );
    Ok(())
}

/// Task 0.3: an unregistered merchant is refused while the sponsor is still
/// looking, instead of producing a payment that passes every check and vanishes.
#[tokio::test]
async fn approving_an_unregistered_merchant_is_refused() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = setup(&worker).await?;
    let stranger = worker.root_account()?.create_subaccount("stranger").transact().await?.into_result()?;

    w.sponsor
        .call(w.gm.id(), "create_campaign")
        .args_json(json!({ "id": "acme", "campaign": campaign(w.token.id().as_str(), vec![]) }))
        .transact()
        .await?
        .into_result()?;

    let out = w
        .sponsor
        .call(w.gm.id(), "set_merchants")
        .args_json(json!({ "id": "acme", "merchants": [stranger.id()] }))
        .deposit(ONE_YOCTO)
        .max_gas()
        .transact()
        .await?;
    let err = format!("{:?}", out.into_result().unwrap_err());
    assert!(err.contains("not registered for storage"), "expected a named refusal, got: {err}");
    Ok(())
}

/// 🔴 `key_allowance` is a **prepaid-gas** budget, and the runtime checks it per
/// transaction before anything runs. Set it below the cost of one call and the
/// grant is dead on arrival: every payment fails with `NotEnoughAllowance` while
/// the USDC budget sits there untouched, and nothing in the contract's own error
/// messages explains why.
///
/// This test exists because the number is a sponsor-facing setting and the wrong
/// value looks like a bug in us.
#[tokio::test]
async fn an_allowance_below_one_call_bricks_the_grant() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let w = setup(&worker).await?;

    let mut c = campaign(w.token.id().as_str(), vec![]);
    c["key_allowance"] = json!(NearToken::from_millinear(1).as_yoctonear().to_string());
    w.sponsor.call(w.gm.id(), "create_campaign").args_json(json!({ "id": "acme", "campaign": c }))
        .transact().await?.into_result()?;
    w.sponsor.call(w.token.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": w.gm.id(), "amount": (500 * USDC).to_string(), "msg": "acme" }))
        .deposit(ONE_YOCTO).max_gas().transact().await?.into_result()?;
    w.sponsor.call(w.gm.id(), "set_merchants")
        .args_json(json!({ "id": "acme", "merchants": [w.merchant.id()] }))
        .deposit(ONE_YOCTO).max_gas().transact().await?.into_result()?;
    w.dev.call(w.gm.id(), "claim_grant")
        .args_json(json!({ "campaign_id": "acme", "repo": "r", "agent_pk": w.agent_key.public_key().to_string() }))
        .max_gas().transact().await?.into_result()?;

    let err = agent(&w, &worker)
        .call(w.gm.id(), "pay_merchant")
        .args_json(json!({ "to": w.merchant.id(), "amount": USDC.to_string(), "memo": "x" }))
        .gas(AGENT_GAS)
        .transact()
        .await
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(err.contains("NotEnoughAllowance"), "expected NotEnoughAllowance, got: {err}");

    // The money never moved, and the ledger never recorded an attempt.
    assert_eq!(balance(&w.token, w.merchant.id().as_str()).await?, 0);
    Ok(())
}
