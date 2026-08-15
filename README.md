# Sponsored Compute

Sponsored Compute lets a project sponsor give contributors purpose-bound XSGD credits for approved infrastructure. A contributor can use the credit only through an agent checkpoint and only with the merchant that the sponsor allowed.

The demo runs on **Avalanche Fuji** (`43113`) and uses an x402-style EIP-3009 payment flow. It is a focused PBM-compatible prototype, not a full ERC-7291 implementation.

## What it solves

A sponsor funds a campaign for a repository instead of sending tokens directly to an unknown contributor. When a contributor claims the campaign, the resulting Grant is bound to:

- the repository campaign;
- an approved merchant and its `payTo` wallet;
- a per-transaction limit, daily limit, expiry, and revocation status; and
- the exact x402 payment requirement.

The agent never receives an unrestricted `unwrap` operation. It can pay a merchant only after the local checkpoint verifies the request.

## Architecture

```text
Sponsor
  │ funds XSGD
  ▼
GrantManager ──► Grant for contributor ──► Agent checkpoint
  │                                             │ validates policy
  ▼                                             ▼
MerchantRegistry ◄──────────────────────── x402 merchant API
                                                  │
                                        settlement relay + ledger
```

On-chain contracts hold the authority. The web registry and Supabase tables provide discovery, payment history, and replay protection; neither can create a valid grant by itself.

## Repository layout

```text
contracts/     Solidity contracts, deployment scripts, and Hardhat tests
src/           Shared TypeScript: grants, policy checkpoint, signer, relay, CLI
mcp/           MCP server exposed to coding agents
web/           Next.js sponsor console, merchant dashboard, and API routes
web/supabase/  SQL schema for persistent registry and payment data
docs/          Product, security, workflow, research, and demo documentation
scripts/       Local seed and merchant-generation utilities
deployments/   Network deployment addresses
```

## Prerequisites

- Node.js 20 or newer
- An Avalanche Fuji wallet with test AVAX for relayer gas
- XSGD on Fuji for funding a campaign
- Supabase for any shared or Vercel deployment

## Run locally

Install the root tooling and build the CLI/MCP package:

```bash
npm install
npm run build
```

Configure and run the web app:

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:4030`:

- `/` — landing page and agent walkthrough
- `/sponsor` — create/fund a repository campaign
- `/merchant` — merchant dashboard and settlement history
- `/api/v1/query` — x402-protected merchant API

Optional demo merchant instances:

```bash
cd web
npm run dev:neon  # NeonLite on :4032
npm run dev:evil  # malicious merchant on :4031
```

## Environment configuration

Start from [`web/.env.example`](web/.env.example). Never commit `.env.local` or a real private key.

| Variable | Purpose | Required on Vercel |
| --- | --- | --- |
| `CHAIN_ID` | Avalanche network ID; Fuji is `43113` | Yes |
| `MERCHANT_PAYTO` | Wallet that receives merchant payments | Yes |
| `GRANT_MANAGER` | Contract address when not using the configured demo | As needed |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret key | Yes |
| `RELAYER_PRIVATE_KEY` | Server-only wallet for settlement and testnet merchant approval | Yes |
| `X402_SETTLEMENT_PROVIDER` | `self-relay` settles through this app's own relayer; `0xgasless` defers to the external facilitator | Yes |
| `SPONSORED_REGISTRY_URL` | Public URL used by the CLI/MCP claim flow | Yes after deploy |
| `SPONSORED_CLI_SPEC` | CLI package/GitHub spec emitted by the sponsor console | Yes until published |
| `SPONSORED_MCP_SPEC` | MCP package/GitHub spec emitted by the sponsor console | Yes until published |

For local work only, `SPONSORED_LOCAL_GRANT=1` reads Grant state from the `.grant-dev.json` fixture instead of the chain. Never set it in a deployed environment: it makes the checkpoint authorize against a hand-editable file.

`RELAYER_PRIVATE_KEY` must have Fuji AVAX. When `SPONSORED_AUTO_APPROVE_MERCHANTS=1`, it must also be the owner of the deployed MerchantRegistry. Do not enable automatic merchant approval for a mainnet deployment without a deliberate security review.

## Supabase setup

For local-only demos the app can use process memory, but that mode is unsafe for a serverless or multi-instance deployment: payment history disappears and nonce replay protection is not shared.

Create a Supabase project, then run [`web/supabase/schema.sql`](web/supabase/schema.sql) in its SQL Editor. Add the project URL and server secret to your environment. The schema stores payment claims, settlement history, sponsored repositories, and reported grant claims.

## Deploy to Vercel

1. Push the repository to GitHub and import it in [Vercel](https://vercel.com/new).
2. Set **Root Directory** to `web`.
3. Add the variables from `web/.env.example` in **Settings → Environment Variables**. Set secrets for Production only unless preview environments need access.
4. Ensure the Supabase schema has been run before deployment.
5. Deploy using Vercel's defaults: `npm install` and `npm run build`.
6. Copy the assigned production URL into `SPONSORED_REGISTRY_URL`, then redeploy.

The Next.js route handlers run as Node.js serverless functions. No separate backend host is needed.

## Agent setup

The project ships MCP declarations for Claude Code and Codex. The available actions are:

1. `list_sponsored_platforms(category)`
2. `check_project_sponsorship()`
3. `claim_sponsored_grant()`
4. `get_grant_status()`
5. `pay_for_service(url, max_amount)`

The first two are read-only. Claiming and paying create external effects and should be called only with explicit user approval.

Once a Grant is claimed, `claim_sponsored_grant` records its `projectId` in `sponsored.json`, and the remaining tools read it from there. Set `PROJECT_ID` only to override that pointer.

## Sponsor operations from the CLI

The sponsor console drives these through a browser wallet. The same operations are available headless, which is what makes campaigns scriptable and testable:

```bash
sponsored-compute create-campaign --campaign 0x… --sponsor supadb --grant-amount 1000000
sponsored-compute fund-campaign  --campaign 0x… --amount 2000000
sponsored-compute revoke-grant   --grant-id 2
sponsored-compute withdraw-unused --campaign 0x…
```

Amounts are atomic units — 6 decimals for XSGD, 18 for AVAX; add `--asset avax` for a native gas campaign. Every command is signed by the agent wallet and reverts unless that wallet is the campaign sponsor. `sponsored-compute --help` lists the full set.

## Verify

```bash
npm run typecheck
npm test

cd web
npm run build
```

## Documentation

- [Payment workflow](docs/WORKFLOW.md)
- [Architecture and security decisions](docs/SPONSORED-COMPUTE.md)
- [Demo runbook](docs/DEMO.md)
- [Research and alternatives](docs/RESEARCH.md)
- [Decision log](docs/DECISION.md)

## Security notes

- Treat `RELAYER_PRIVATE_KEY` and `SUPABASE_SECRET_KEY` as production secrets.
- Never place server secrets in variables prefixed with `NEXT_PUBLIC_`.
- Supabase is required in deployed environments to make replay protection atomic across functions.
- The x402 requirement is bound to the expected network, XSGD asset, recipient, amount, timeout, and resource before settlement.
- The included automatic merchant-approval route is a Fuji demo convenience, not a recommended mainnet default.
