# Sponsored Compute

Purpose-bound XSGD credits for AI coding agents: sponsors fund a pool, projects receive a Grant, and the agent can only pay merchants approved through x402.

> **Demo chain:** Avalanche Fuji (`43113`). This is a PBM-compatible subset, not a full ERC-7291 implementation.

## Docs

- [Payment workflow](docs/WORKFLOW.md)
- [Demo runbook](docs/DEMO.md)
- [Architecture and decisions](docs/SPONSORED-COMPUTE.md)
- [Research and options considered](docs/RESEARCH.md)

## Architecture

```text
Sponsor ── XSGD ──> GrantManager ── conditional unwrap ──> agent EOA
                              │                                  │
                       MerchantRegistry <── allowlist       EIP-3009 x402
                              │                                  │
                         merchant payTo <── settlement relay ─── platform API
```

The checkpoint runs inside `pay_for_service`; the MCP server never exposes `unwrap`, `sign`, or a policy bypass.

## Running the demo

```bash
npm install
npm run build
npm run address
npm run balance

cd web
npm install
cp .env.example .env.local  # add the relayer key for the AVAX-only wallet
npm run dev
```

One deployment serves the whole demo at `http://localhost:4030`:

- `/` — landing + prompt walkthrough
- `/sponsor` — sponsor console
- `/merchant` — merchant dashboard + settlement ledger
- `/api/v1/query` — x402-metered API

Run the two extra demo merchants in separate terminals:

```bash
cd web && npm run dev:neon  # NeonLite :4032
cd web && npm run dev:evil  # malicious merchant :4031
```

The local MCP server is declared in `.mcp.json`. Five tools:

1. `list_sponsored_platforms(category)`
2. `check_project_sponsorship()` — read-only; reads `sponsored.json` and verifies the campaign on-chain
3. `claim_sponsored_grant()` — issues a Grant for the current wallet; call only when the user asks
4. `get_grant_status()`
5. `pay_for_service(url, max_amount)`

## Sponsor

The main flow is `/sponsor` in `web/`: **paste a GitHub repo → fund XSGD → get one line to drop into the repo**. Sponsors never enter a developer's wallet — at funding time nobody knows who will build yet; the Grant is issued later, when a developer claims.

Every on-chain id (`merchantId`, `campaignId`) is derived from the repo URL itself (`src/campaign.ts`), so two people who paste the same repo always land on the same campaign. The page reads Fuji state and sequences itself into one button:

1. Connect a wallet (it becomes the merchant `payTo` and the campaign sponsor)
2. Create the campaign — the per-developer Grant size is locked in at this point
3. Approve + fund XSGD
4. Get the install command — signs nothing, just re-reads the chain and generates the command

Merchants are **auto-approved** on testnet (the server signs with the `MerchantRegistry` owner key, see `web/app/api/registry/merchant`) so the demo doesn't stall on manual review. This is **disabled by default on mainnet** unless `SPONSORED_AUTO_APPROVE_MERCHANTS=1` is set explicitly — the allowlist exists to stop an attacker from registering their own wallet as a merchant and `unwrap`-ing a Grant straight to it (see `docs/SPONSORED-COMPUTE.md` §9).

The lower-level scripts (`contracts/scripts/register.ts`, `scripts/seed.ts`, `npm run cli -- init`) still work for seeding data or running outside the UI.

## Developer onboarding

```bash
git clone <sponsored repo>
cd <repo>
```

Open Claude Code (`.mcp.json`) or Codex CLI (`.codex/config.toml`) — both load the MCP server automatically — then ask:

> does this project have sponsorship?

The agent calls `check_project_sponsorship` (reads `sponsored.json`, verifies on-chain, signs nothing), then asks before calling `claim_sponsored_grant`. Claiming writes `projectId` back to `sponsored.json` and reports the claim to the registry for lookup — both are **best-effort**; the real Grant lives on-chain regardless of whether the registry write succeeds.

The install command a sponsor pastes into a repo looks like this — `npx --package` targets the GitHub repo directly, since the package isn't on npm yet (`SPONSORED_CLI_SPEC` / `SPONSORED_MCP_SPEC` in `web/.env.local` control this; see `.env.example`):

```bash
npx -y --package github:kurodenjiro/sponsored-compute sponsored-compute init \
  --campaign 0x… --sponsor <slug> --repo <repo-url> --chain 43113
```

Running it from a local clone is equivalent:

```bash
npm run cli -- init --campaign 0x… --sponsor <slug> --repo <repo-url> --chain 43113
npm run cli -- sponsorship         # read status, signs nothing
npm run cli -- claim-grant         # issue a Grant for the current wallet
```

`init` writes `sponsored.json`, `.mcp.json`, and `.codex/config.toml` (project-scoped — Codex only loads it for trusted projects, and this never touches `~/.codex/config.toml`); it never writes a private key, API key, or developer wallet. The contract rejects a `projectId` that has already received a Grant — one Grant per wallet, so forking a repo can't clone the money.

Once SupaDB usage reaches 0.30 XSGD, a developer can request the next tranche — different from `claim-grant` (issuing a Grant for the first time), the `claim` command here opens the next tranche of a Grant that already exists:

```bash
CHAIN_ID=43113 GRANT_MANAGER=0x3230B5666d8De86d3079D07bb45A7075A1d0b043 \
PROJECT_ID=0xb34e1d43700c753c79fa98a98c434b921d9d3467e3f07f78ada83890ab8162bc \
npm run cli -- claim
```

Verified on Fuji: transaction
[`0xb7b03fa8…c387c`](https://testnet.snowtrace.io/tx/0xb7b03fa8d4dde103d5daaf9584f7924b72e9974c55951dae239901f6c29c387c)
released tranche 2, raising the SupaDB Grant's vested balance from 0.50 to 1.00 XSGD.

## Blocked-demo scene

```bash
# malicious merchant: the challenge carries a prompt-injection instruction and demands 30 XSGD
cd web && npm run dev:evil
```

Calling the malicious endpoint through `pay_for_service` must be rejected by the checkpoint before `unwrap`: wrong `payTo`, over `max_amount`/per-tx cap. `npm run build` and `npm test` cover the merchant allowlist, vesting, expiry, revoke, replay policy, and binding the authorization to the exact invoice.

## Operator-provided requirements

- AVAX on Fuji for the signer (unwrap) and the self-relayer (settlement).
- XSGD on Fuji for sponsors to fund campaigns.
- A private key **only** for the self-relayer, in `web/.env.local`; never commit this file.
- Self-relay is the default provider, already E2E-verified against the current merchant `payTo`. Only enable `0xgasless` after verifying it end-to-end with the exact XSGD/Fuji/recipient combination — the public facilitator currently rejects the SupaDB demo recipient and its docs don't publish a whitelisting process.
- The `MerchantRegistry` owner wallet, to approve new merchants — unless using the testnet auto-approve path (`RELAYER_PRIVATE_KEY` must then be that same owner wallet; set `SPONSORED_AUTO_APPROVE_MERCHANTS=0` to turn it off).
