# Sponsored Compute — Onboarding & Payment Workflow

## Onboarding: repo → funded campaign → developer Grant

Sponsor chỉ dán URL repo. Mọi id on-chain suy ra từ đó ([src/campaign.ts](../src/campaign.ts)),
nên không có chỗ nào để gõ sai tên campaign.

```mermaid
flowchart TD
    R["Sponsor dán repo URL<br/>/sponsor"] -->|"campaignId = f(repo)"| C["createCampaign + fund XSGD<br/>ví sponsor ký"]
    C --> REG["POST /api/registry<br/>verify campaign on-chain TRƯỚC khi ghi"]
    REG -->|"trả 1 dòng lệnh"| CMD["npx @sponsored-compute/cli init --campaign 0x… --repo …"]
    CMD --> FILES["sponsored.json + .mcp.json<br/>commit vào repo · KHÔNG có bí mật"]

    FILES --> DEV["Dev clone repo → mở Claude Code"]
    DEV --> ASK["check_project_sponsorship<br/>đọc con trỏ, verify on-chain, không ký gì"]
    ASK -->|"user đồng ý"| CLAIM["claim_sponsored_grant<br/>projectId = f(campaignId, ví dev)"]
    CLAIM --> GM["issueGrant() — permissionless<br/>contract là bên enforce"]
    GM --> BACK["ghi projectId về sponsored.json<br/>+ POST /api/registry/claim (chỉ để tra cứu)"]
    BACK --> PAY["từ đây trở đi: pay_for_service (bên dưới)"]
```

- **Claim ≠ pay.** Claim cắt `grantAmount` từ pool thành Grant của một ví (XSGD chưa rời contract).
  Pay là mỗi lần gọi API, tiêu đúng số của lần đó trong hạn mức Grant.
- Repo fork lại mang `projectId` đã dùng → `ProjectAlreadyGranted`. Fork không nhân bản được tiền.
- Registry (`/api/registry`) **không cấp quyền**: nó chỉ chép lại thứ đã có trên chain, và
  route ghi luôn đọc chain trước. Registry chết thì Grant vẫn hợp lệ.

## Payment

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
