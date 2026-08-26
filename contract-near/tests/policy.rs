//! Ledger + policy tests for grant-manager.
//!
//! These run in near-sdk's mocked VM: they cover every rule the contract
//! enforces on its own state — caps, vesting, repo lock, allowlist, revocation.
//! The cross-contract `ft_transfer` leg is out of reach here and belongs to the
//! near-workspaces sandbox test (see contract-near/README.md).

use grant_manager::{Campaign, GrantManager};
use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken, PublicKey};

const DAY_NS: u64 = 86_400_000_000_000;
const USDC: u128 = 1_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

/// Curve-prefixed ed25519 key: 1 type byte + 32 key bytes. Deterministic, so a
/// failing test names the same key every run.
fn pk(seed: u8) -> PublicKey {
    let mut v = vec![0u8; 33];
    v[32] = seed;
    PublicKey::try_from(v).unwrap()
}

fn ctx(predecessor: &str, signer_pk: PublicKey, ts: u64, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("grant-manager.test.near"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_pk(signer_pk)
        .block_timestamp(ts)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    b
}

fn campaign() -> Campaign {
    Campaign {
        // Overwritten by create_campaign — caller input is never trusted here.
        sponsor: acc("nobody.test.near"),
        token_id: acc("usdc.test.near"),
        merchants: vec![acc("neonlite.test.near")],
        funded: U128(0),
        committed: U128(0),
        grant_amount: U128(50 * USDC),
        tranche_count: 10,
        tranche_period_ns: U64(DAY_NS),
        min_spend_per_tranche: U128(2 * USDC),
        grant_validity_ns: U64(30 * DAY_NS),
        per_tx_cap: U128(2 * USDC),
        daily_cap: U128(4 * USDC),
        key_allowance: U128(NearToken::from_millinear(100).as_yoctonear()),
        paused: false,
    }
}

/// Funded campaign with one grant claimed against `repo`, ready to spend.
fn funded_with_grant() -> GrantManager {
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 0).build());
    let mut gm = GrantManager::new();
    gm.create_campaign("acme".into(), campaign());

    testing_env!(ctx("usdc.test.near", pk(1), 0, 0).build());
    gm.ft_on_transfer(acc("sponsor.test.near"), U128(500 * USDC), "acme".into());

    testing_env!(ctx("dev.test.near", pk(1), 0, 0).build());
    gm.claim_grant("acme".into(), "github.com/dev/repo".into(), pk(7));
    gm
}

/// Context for the agent spending path: signed by the grant key, predecessor is
/// the contract itself — what a function-call access key on the contract yields.
fn agent(ts: u64) -> VMContextBuilder {
    ctx("grant-manager.test.near", pk(7), ts, 0)
}

#[test]
fn claim_issues_first_tranche_and_commits_funds() {
    let gm = funded_with_grant();
    let g = gm.get_grant(U64(1)).expect("grant");
    assert_eq!(g.total.0, 50 * USDC);
    // 1 of 10 tranches — §7.2 layer 4: a sybil that clears the repo bar walks
    // away with 5 USDC, not 50.
    assert_eq!(g.released.0, 5 * USDC);
    assert_eq!(g.spent.0, 0);
    assert!(!g.revoked);
    let c = gm.get_campaign("acme".into()).unwrap();
    assert_eq!(c.funded.0, 500 * USDC);
    assert_eq!(c.committed.0, 50 * USDC);
    assert_eq!(c.sponsor, acc("sponsor.test.near"));
}

#[test]
fn grant_is_findable_by_repo() {
    let gm = funded_with_grant();
    assert_eq!(
        gm.get_grant_by_repo("acme".into(), "github.com/dev/repo".into()).unwrap().id.0,
        1
    );
    assert!(gm.get_grant_by_repo("acme".into(), "github.com/dev/other".into()).is_none());
}

#[test]
#[should_panic(expected = "repo already granted")]
fn one_repo_one_grant() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("attacker.test.near", pk(1), 0, 0).build());
    gm.claim_grant("acme".into(), "github.com/dev/repo".into(), pk(8));
}

#[test]
#[should_panic(expected = "key already bound")]
fn one_key_one_grant() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("dev.test.near", pk(1), 0, 0).build());
    gm.claim_grant("acme".into(), "github.com/dev/second".into(), pk(7));
}

#[test]
fn spending_moves_the_ledger() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
    let g = gm.get_grant(U64(1)).unwrap();
    assert_eq!(g.spent.0, USDC);
    assert_eq!(g.spent_today.0, USDC);
}

#[test]
#[should_panic(expected = "merchant not in the campaign allowlist")]
fn merchant_allowlist_is_the_source_of_truth() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("evil.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "over the per-transaction cap")]
fn per_tx_cap_holds() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(3 * USDC), None);
}

#[test]
#[should_panic(expected = "over the daily cap")]
fn daily_cap_holds() {
    let mut gm = funded_with_grant();
    for _ in 0..2 {
        testing_env!(agent(0).build());
        gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    }
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
fn daily_cap_resets_on_a_new_day() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    testing_env!(agent(DAY_NS + 1).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    let g = gm.get_grant(U64(1)).unwrap();
    assert_eq!(g.spent.0, 4 * USDC);
    assert_eq!(g.spent_today.0, 2 * USDC);
}

#[test]
#[should_panic(expected = "beyond the vested amount")]
fn cannot_outspend_the_released_tranche() {
    let mut gm = funded_with_grant();
    // 5 USDC released, 4/day cap: day 1 takes 4, day 2 may only take 1 more.
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    testing_env!(agent(DAY_NS + 1).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
}

#[test]
#[should_panic(expected = "grant expired")]
fn expiry_stops_spending() {
    let mut gm = funded_with_grant();
    testing_env!(agent(31 * DAY_NS).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "this key has no grant")]
fn an_unbound_key_buys_nothing() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("grant-manager.test.near", pk(99), 0, 0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "call this with the grant's function-call access key")]
fn a_direct_call_cannot_impersonate_the_key_path() {
    let mut gm = funded_with_grant();
    // Right key, wrong route: an ordinary transaction from another account.
    testing_env!(ctx("attacker.test.near", pk(7), 0, 0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "campaign paused")]
fn pausing_the_campaign_stops_every_grant_under_it() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 1).build());
    gm.set_paused("acme".into(), true);
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "not the sponsor")]
fn only_the_sponsor_pauses() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("dev.test.near", pk(1), 0, 1).build());
    gm.set_paused("acme".into(), true);
}

#[test]
fn tranche_vests_against_real_usage() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    testing_env!(agent(DAY_NS + 1).build());
    assert_eq!(gm.claim_tranche().0, 10 * USDC);
    assert_eq!(gm.get_grant(U64(1)).unwrap().tranche_claimed, 2);
}

#[test]
#[should_panic(expected = "not enough real usage")]
fn tranche_needs_spend_not_just_time() {
    let mut gm = funded_with_grant();
    testing_env!(agent(DAY_NS + 1).build());
    gm.claim_tranche();
}

#[test]
#[should_panic(expected = "tranche not ready")]
fn tranche_needs_time_not_just_spend() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);
    testing_env!(agent(1).build());
    gm.claim_tranche();
}

#[test]
fn revoke_returns_the_unspent_commitment() {
    let mut gm = funded_with_grant();
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(2 * USDC), None);

    testing_env!(ctx("sponsor.test.near", pk(1), 0, 1).build());
    gm.revoke_grant(U64(1));

    assert!(gm.get_grant(U64(1)).unwrap().revoked);
    // 50 committed − 48 unspent = 2 still committed, matching what was spent.
    assert_eq!(gm.get_campaign("acme".into()).unwrap().committed.0, 2 * USDC);
}

#[test]
#[should_panic(expected = "this key has no grant")]
fn revocation_kills_the_key_immediately() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 1).build());
    gm.revoke_grant(U64(1));
    // The runtime would already refuse the transaction; the contract refuses too.
    testing_env!(agent(0).build());
    gm.pay_merchant(acc("neonlite.test.near"), U128(USDC), None);
}

#[test]
#[should_panic(expected = "only the sponsor revokes")]
fn a_developer_cannot_revoke_their_own_grant_away() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("dev.test.near", pk(1), 0, 1).build());
    gm.revoke_grant(U64(1));
}

#[test]
#[should_panic(expected = "wrong token for this campaign")]
fn a_foreign_token_cannot_fund_a_campaign() {
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 0).build());
    let mut gm = GrantManager::new();
    gm.create_campaign("acme".into(), campaign());
    testing_env!(ctx("shitcoin.test.near", pk(1), 0, 0).build());
    gm.ft_on_transfer(acc("sponsor.test.near"), U128(500 * USDC), "acme".into());
}

#[test]
#[should_panic(expected = "campaign out of funds")]
fn claims_stop_when_the_campaign_runs_dry() {
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 0).build());
    let mut gm = GrantManager::new();
    gm.create_campaign("acme".into(), campaign());
    testing_env!(ctx("usdc.test.near", pk(1), 0, 0).build());
    gm.ft_on_transfer(acc("sponsor.test.near"), U128(60 * USDC), "acme".into());

    testing_env!(ctx("dev.test.near", pk(1), 0, 0).build());
    gm.claim_grant("acme".into(), "github.com/a/one".into(), pk(7));
    testing_env!(ctx("dev2.test.near", pk(1), 0, 0).build());
    gm.claim_grant("acme".into(), "github.com/a/two".into(), pk(8));
}

#[test]
fn a_grant_is_findable_by_the_key_that_spends_it() {
    let gm = funded_with_grant();
    // The agent holds only its key, so this is the lookup it can always do.
    assert_eq!(gm.get_grant_by_key(pk(7)).unwrap().id.0, 1);
    assert!(gm.get_grant_by_key(pk(99)).is_none());
}

#[test]
fn revocation_unbinds_the_key_from_the_grant() {
    let mut gm = funded_with_grant();
    testing_env!(ctx("sponsor.test.near", pk(1), 0, 1).build());
    gm.revoke_grant(U64(1));
    assert!(gm.get_grant_by_key(pk(7)).is_none());
}

#[test]
fn policy_view_reports_what_the_contract_enforces() {
    let gm = funded_with_grant();
    let (merchants, per_tx, daily, token) = gm.get_policy(U64(1)).unwrap();
    assert_eq!(merchants, vec![acc("neonlite.test.near")]);
    assert_eq!(per_tx.0, 2 * USDC);
    assert_eq!(daily.0, 4 * USDC);
    assert_eq!(token, acc("usdc.test.near"));
}
