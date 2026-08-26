# grant-manager (NEAR)

Purpose-bound infrastructure credit for AI agents, on NEAR. Port of
[`contracts/src/GrantManager.sol`](../contracts/src/GrantManager.sol); plan in
[`docs/PROPOSAL-NEAR.md`](../docs/PROPOSAL-NEAR.md).

Live on testnet: [`gm.anyone3-pay.testnet`](https://testnet.nearblocks.io/address/gm.anyone3-pay.testnet)

## ⚠️ Always build through `npm run near:build`

`near-sdk` only routes host calls — panics included — to the NEAR runtime under
`cfg(all(near, target_arch = "wasm32"))`. A plain
`cargo build --target wasm32-unknown-unknown --release` does **not** set
`--cfg near`, and the SDK quietly takes its local fallback path instead. The
contract still deploys and still enforces every rule, but each `require!`
reaches the caller as `WebAssembly trap: unreachable` with the message stripped
off — so "over the daily cap" becomes an unexplained failure.

[`.cargo/config.toml`](.cargo/config.toml) sets the flag for the wasm target.
Verified on testnet 26/08/2026, before and after.

```bash
npm run near:build     # wasm → contract-near/target/wasm32-unknown-unknown/release/
npm run near:test      # 24 policy tests, mocked VM, no network
npm run near:deploy    # redeploy to $NEAR_GRANT_MANAGER (default: the testnet address above)
npm run near:spike     # full end-to-end run against testnet
```

## Where the access key lives

`docs/PROPOSAL-NEAR.md` §1 draws the FunctionCall access key landing on the
*agent's* NEAR account. The runtime does not allow that: `AddKey` and `DeleteKey`
are only valid when `predecessor_id == receiver_id`, so a contract can manage
keys on itself and nowhere else — not even on a sub-account it just created.

So `claim_grant` adds the key to **`grant-manager.near` itself**, restricted to
`method_names = pay_merchant,claim_tranche`. The agent holds the secret half and
signs with `signer_id = grant-manager.near`; the contract recognises which grant
is spending from `env::signer_account_pk()`, never from `predecessor_account_id`
(which is always the contract on that path).

Every property the proposal leans on survives, and revocation gets stronger:

| Proposal claim | How it holds |
| --- | --- |
| `receiver_id` | pinned to this contract — the key reaches nothing else |
| `method_names` | two methods, neither of which can move funds off-allowlist |
| `allowance` | gas ceiling; an exhausted key simply stops working |
| `DeleteKey` | the contract deletes it — the agent's cooperation is not required |
| no attached NEAR | FunctionCall keys cannot attach deposit, by protocol |

A side effect worth knowing: gas for `pay_merchant` is paid by the contract
account, capped per grant by `allowance`. The agent needs no NEAR at all and no
account of its own.

`allowance` is a **gas** budget in yoctoNEAR — not a spend cap. Spend caps live
in `Campaign`/`Grant`. The key decides *who may call what*; contract state
decides *how much*.

## Two layers, one rule set

`src/core/policy.ts` refuses a bad payment on the client, before any round trip.
`pay_merchant` refuses it again on-chain, where nobody can patch it out. Both are
exercised in steps 7 and 8 of [`scripts/near-spike.sh`](../scripts/near-spike.sh)
— the same two requests, once through the checkpoint and once around it:

```
[checkpoint] DENIED (MERCHANT_NOT_ALLOWED): payTo agenttest1.testnet is not in this Grant's allowlist.
Smart contract panicked: merchant not in the campaign allowlist
```

## Anti-abuse mapped to the code

| §7.2 layer | Where |
| --- | --- |
| 1. `(campaign, repo)` lock | `grant_of_repo`, checked in `claim_grant` |
| 3. sponsor-set thresholds | off-chain, sponsor's verifier (not in the contract) |
| 4. tranche release | `released` starts at `grant_amount / tranche_count`; `claim_tranche` needs elapsed time **and** `min_spend_per_tranche` of real usage |
| 5. sponsor-curated merchants + clawback | `Campaign.merchants`, `set_merchants`, `revoke_grant` |

## Testing

`tests/policy.rs` runs 24 cases in near-sdk's mocked VM: caps, day rollover,
vesting, repo lock, key binding, allowlist, pause, revocation, and the two paths
that must never be confused for each other (`grant_id_of_signer`).

Not covered there, because the mocked VM has no second contract: the
`ft_transfer` leg and its rollback callback. `scripts/near-spike.sh` covers those
against a live token on testnet; a `near-workspaces` sandbox test is the next
step so CI can check them without a network.
