# Sponsored Compute

Purpose-bound infrastructure credit, granted to an AI agent instead of a person.

A dev-tool platform funds a campaign on **NEAR**. A developer's coding agent claims a grant bound to
their **repository**, then pays real [x402](https://x402.org) merchants on **Base** — from an address
that the NEAR contract itself controls. The sponsor deletes one access key and spending stops on both
chains at once.

> **Status:** contract live on NEAR testnet, full flow proven end to end.
> Plan: [docs/ROADMAP-NEAR-MVP.md](docs/ROADMAP-NEAR-MVP.md) · Work split: [docs/TASKS-NEAR.md](docs/TASKS-NEAR.md)
>
> The Avalanche/XSGD build this grew out of was removed on 26/08/2026; its reasoning is kept in
> [docs/archive/](docs/archive/).

## Why NEAR holds the money

A NEAR `FunctionCall` access key already *is* most of what purpose-bound credit needs, at the protocol
level rather than in a thousand lines of audited contract:

```
receiver_id   → the key reaches exactly one contract
method_names  → and exactly two of its methods
allowance     → a gas ceiling; an exhausted key simply stops
DeleteKey     → revocation in one transaction
```

The key cannot attach NEAR, so it cannot move value on its own — it can only ask the contract, and the
contract checks the allowlist, the per-transaction cap, the daily cap, the vested amount and the expiry
before anything moves.

One detail worth knowing before reading the contract: the key lives on `grant-manager` itself, not on
the agent's account. NEAR only permits `AddKey`/`DeleteKey` when `predecessor == receiver`, so a
contract can key itself and nothing else. That makes revocation *stronger* — the contract deletes the
key without the agent's cooperation — and it means **the agent needs no NEAR account and no balance at
all**; gas is paid by the contract, bounded by `allowance`. Details:
[contract-near/README.md](contract-near/README.md).

## Why Base holds the merchants

x402 has a NEAR binding in the spec, but no facilitator settles it — the public facilitator at
x402.org advertises `eip155:84532` among EVM networks and nothing for NEAR (verified 26/08/2026).
The merchants worth paying are on Base. So the Base address is derived from the NEAR contract through
[Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures):

```
gm.anyone3-pay.testnet + path "grant-1"  →  0x7De1259Cc50963091551B29DA22fDd01a0b8Ca79
```

No private key exists for that address, anywhere. Only the contract can sign for it, and only after the
same caps pass again. That is the whole architecture in one line.

## Two layers, one rule set

`src/core/policy.ts` refuses a bad payment on the client, before any round trip.
`pay_merchant` refuses it again on-chain, where nobody can patch it out. Steps 7 and 8 of the spike run
the same two requests, once through the checkpoint and once around it:

```
[checkpoint] DENIED (MERCHANT_NOT_ALLOWED): payTo agenttest1.testnet is not in this Grant's allowlist.
Smart contract panicked: merchant not in the campaign allowlist
```

## Layout

```text
contract-near/   grant-manager (Rust, near-sdk) + policy tests
src/core/        chain-agnostic domain model, the policy decision, the key store
src/near/        NEAR config, agent key, grant reader, NEAR-leg checkpoint
src/base/        Base config, EIP-3009 / x402 v2 client, derived-address helpers
scripts/         agent CLI and the end-to-end testnet spike
web/             Next.js app shell — console rebuilt in Wave 3
docs/            roadmap, task split, proposals; docs/archive/ holds the Avalanche era
```

## Quickstart

```bash
npm install
npm test            # policy + keystore + 24 contract tests
```

Run the whole flow against live testnet — campaign, funding, claim, payment, both refusal layers, and
revocation:

```bash
CAMPAIGN=demo1 REPO=github.com/you/your-repo npm run near:spike
```

Read a grant the way the agent does:

```bash
npm run near:agent -- status demo1 github.com/you/your-repo
```

Requires Node 20+, the [`near`](https://github.com/near/near-cli-rs) CLI with a funded testnet
account, and a Rust toolchain with the `wasm32-unknown-unknown` target for contract work.

## Contract work

```bash
npm run near:build     # ALWAYS build through this — see contract-near/README.md
npm run near:test
npm run near:deploy
```

`cargo build` on its own omits `--cfg near`, and near-sdk then strips every `require!` message down to
`WebAssembly trap: unreachable`. The contract still enforces its rules; you just stop being able to
see which one refused.

## Deployment

Testnet: [`gm.anyone3-pay.testnet`](https://testnet.nearblocks.io/address/gm.anyone3-pay.testnet),
token `usdc.fakes.testnet`. Recorded in [deployments/near-testnet.json](deployments/near-testnet.json).
