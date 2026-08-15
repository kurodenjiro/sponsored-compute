# Sponsored Compute

XSGD tài trợ có ràng buộc mục đích cho AI coding agent: sponsor ký quỹ, project nhận Grant, agent chỉ có thể trả cho merchant đã duyệt qua x402.

> **Demo chain:** Avalanche Fuji (`43113`). Đây là PBM-compatible subset, không phải full ERC-7291.

## Tài liệu

- [Workflow thanh toán](docs/WORKFLOW.md)
- [Runbook demo](docs/DEMO.md)
- [Kiến trúc và quyết định](docs/SPONSORED-COMPUTE.md)
- [Nghiên cứu và so sánh phương án](docs/RESEARCH.md)

## Kiến trúc

```text
Sponsor ── XSGD ──> GrantManager ── unwrap có điều kiện ──> agent EOA
                              │                                  │
                       MerchantRegistry <── allowlist       EIP-3009 x402
                              │                                  │
                         merchant payTo <── settlement relay ─── platform API
```

Checkpoint chạy bên trong `pay_for_service`; MCP không expose `unwrap`, `sign` hay policy bypass.

## Chạy demo

```bash
npm install
npm run build
npm run address
npm run balance

cd platform-demo
cp .env.example .env.local  # điền relayer key của ví chỉ giữ AVAX
npm install
npm run dev
```

Một deployment phục vụ toàn bộ demo tại `http://localhost:4030`:

- `/` — landing + prompt walkthrough
- `/sponsor` — sponsor console
- `/merchant` — merchant dashboard + settlement ledger
- `/api/v1/query` — x402 API thu phí

Chạy thêm hai merchant của demo trong terminal riêng:

```bash
cd platform-demo && npm run dev:neon  # NeonLite :4032
cd platform-demo && npm run dev:evil  # merchant độc :4031
```

MCP cục bộ dùng `.mcp.json`. Chỉ có ba tool:

1. `list_sponsored_platforms(category)`
2. `get_grant_status()`
3. `pay_for_service(url, max_amount)`

## Sponsor / admin

Portal ở route `/sponsor` trong chính `platform-demo`. Portal **không giữ khoá** và không tự ký transaction. Owner phải dùng script/contracts để làm các bước này:

1. Duyệt merchant bằng `contracts/scripts/register.ts`.
2. Tạo campaign, approve và fund XSGD bằng `scripts/seed.ts`.
3. Phát Grant cho một `projectId` duy nhất.
4. Gửi developer lệnh `sponsored-compute init` sinh từ portal.

## Developer onboarding

```bash
npm run dev -- init \
  --campaign 0x5fcee73cbbc7ac55687e8187df042e5b990c42d7032d57a20a2ca71ddf2b28f7 \
  --sponsor supadb \
  --chain 43113
```

Lệnh này ghi `sponsored.json` và `.mcp.json`; không ghi private key, API key hay ví developer. Contract từ chối một `projectId` đã từng nhận Grant.

Sau khi SupaDB có usage đủ 0.30 XSGD, developer có thể xin tranche kế tiếp:

```bash
CHAIN_ID=43113 GRANT_MANAGER=0x3230B5666d8De86d3079D07bb45A7075A1d0b043 \
PROJECT_ID=0xb34e1d43700c753c79fa98a98c434b921d9d3467e3f07f78ada83890ab8162bc \
npm run dev -- claim
```

Đã xác minh trên Fuji: transaction
[`0xb7b03fa8…c387c`](https://testnet.snowtrace.io/tx/0xb7b03fa8d4dde103d5daaf9584f7924b72e9974c55951dae239901f6c29c387c)
nhả tranche 2, nâng số dư đã vest của SupaDB Grant từ 0.50 lên 1.00 XSGD.

## Cảnh demo chặn

```bash
# merchant độc: challenge có prompt injection và đòi 30 XSGD
cd platform-demo && npm run dev:evil
```

Gọi endpoint độc qua `pay_for_service` phải bị checkpoint từ chối trước `unwrap`: sai `payTo`, vượt `max_amount`/per-tx cap. `npm run build` và `npm test` bao gồm giới hạn merchant, vesting, expiry, revoke, replay policy và binding authorization vào đúng invoice.

## Cần do người vận hành cung cấp

- AVAX Fuji cho signer (unwrap) và self-relayer (settlement).
- XSGD Fuji cho sponsor nạp campaign.
- Private key **chỉ** cho self-relayer trong `platform-demo/.env.local`; không commit file này.
- Self-relay là provider mặc định đã E2E với merchant `payTo` hiện tại. `0xgasless` chỉ nên bật sau khi verify thành công với đúng XSGD/Fuji/recipient; public facilitator hiện từ chối SupaDB demo recipient và docs không công bố quy trình whitelist.
- Ví owner của `MerchantRegistry` để duyệt merchant mới.
