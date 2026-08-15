# Sponsored Compute — Payment Workflow

```mermaid
flowchart TD
    S["Sponsor / owner wallet"] -->|"1. Approve merchant + fund campaign + issue grant"| GM["GrantManager<br/>on Avalanche Fuji"]
    S --> MR["MerchantRegistry<br/>allowlist payTo"]

    A["AI agent / MCP"] -->|"2. Call merchant API"| API["Merchant API<br/>POST /api/v1/query"]
    API -->|"3. 402: XSGD price + payTo"| A

    A --> CP["Checkpoint<br/>off-LLM code"]
    CP -->|"verify: merchant, XSGD, price, cap, vesting, expiry"| GS["Grant state<br/>GrantManager + Registry"]

    CP -->|"Rejected"| STOP["Stop: no unwrap, no signature, no spend"]
    CP -->|"Approved"| UW["4. unwrap(amount, payTo, nonce)"]

    UW --> GM
    GM -->|"on-chain constraints pass"| AW["Agent EOA receives exact XSGD"]
    AW -->|"5. Sign EIP-3009 authorization"| API

    API --> BIND["6. Bind authorization<br/>to exact price + recipient + timeout"]
    BIND -->|"Mismatch/replay"| REJECT["Reject: no settlement"]
    BIND -->|"Valid"| RELAY["7. Self-relay<br/>pays AVAX gas"]

    RELAY --> XSGD["XSGD.transferWithAuthorization"]
    XSGD --> M["Merchant payTo wallet"]
    RELAY --> RECEIPT["8. API response + Snowtrace tx"]

    RECEIPT -. "Next: durable receipt / replay store" .-> DB["Postgres"]
```

## Security boundaries

1. The agent cannot decide to spend by itself: checkpoint runs before unwrap or signing.
2. `GrantManager` enforces merchant allowlist, per-transaction/daily caps, vesting, expiry, and revocation on-chain.
3. The merchant binds the submitted EIP-3009 authorization to the exact invoice recipient, amount, and validity window before self-relay settlement.
4. A mismatch, expired authorization, or replay is rejected before data is served or a transaction is broadcast.
5. The merchant serves the paid response only after the XSGD transfer succeeds on-chain.

## Production follow-up

Use a durable Postgres-backed receipt and nonce-claim store before deployment so payment history and replay protection survive instance restarts and redeploys.
