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

cd web
npm install
cp .env.example .env.local  # add the relayer key for the AVAX-only wallet
npm run dev
```

Một deployment phục vụ toàn bộ demo tại `http://localhost:4030`:

- `/` — landing + prompt walkthrough
- `/sponsor` — sponsor console
- `/merchant` — merchant dashboard + settlement ledger
- `/api/v1/query` — x402 API thu phí

Chạy thêm hai merchant của demo trong terminal riêng:

```bash
cd web && npm run dev:neon  # NeonLite :4032
cd web && npm run dev:evil  # merchant độc :4031
```

MCP cục bộ dùng `.mcp.json`. Năm tool:

1. `list_sponsored_platforms(category)`
2. `check_project_sponsorship()` — read-only, đọc `sponsored.json` rồi verify campaign on-chain
3. `claim_sponsored_grant()` — phát Grant cho ví hiện tại; chỉ gọi khi user yêu cầu
4. `get_grant_status()`
5. `pay_for_service(url, max_amount)`

## Sponsor

Luồng chính là `/sponsor` trong `web/`: **dán repo GitHub → fund XSGD → nhận một dòng lệnh để đưa vào repo**. Sponsor không nhập ví developer — lúc fund thì chưa biết ai sẽ build; Grant phát ra sau, lúc developer claim.

Mọi id on-chain (`merchantId`, `campaignId`) suy ra từ chính URL repo (`src/campaign.ts`), nên hai người dán cùng một repo luôn ra cùng một campaign. Trang tự đọc trạng thái Fuji và tuần tự hoá thành một nút:

1. Kết nối ví (nó là `payTo` của merchant và sponsor của campaign)
2. Tạo campaign — cỡ Grant mỗi developer khoá lúc này
3. Approve + fund XSGD
4. Lấy chuỗi cài — không ký gì, chỉ đọc lại chain rồi sinh lệnh

Merchant được **duyệt tự động** trên testnet (server ký bằng khoá chủ `MerchantRegistry`, xem `web/app/api/registry/merchant`) để demo không kẹt ở bước kiểm duyệt thủ công. Mặc định **tắt trên mainnet** trừ khi đặt `SPONSORED_AUTO_APPROVE_MERCHANTS=1` — allowlist tồn tại để chặn attacker tự đăng ký ví mình làm merchant rồi `unwrap` Grant về đó (xem `docs/SPONSORED-COMPUTE.md` §9).

Các bước cấp thấp hơn (`contracts/scripts/register.ts`, `scripts/seed.ts`, `npm run cli -- init`) vẫn dùng được để seed dữ liệu hoặc chạy ngoài UI.

## Developer onboarding

```bash
git clone <repo được tài trợ>
cd <repo>
```

Mở Claude Code — `.mcp.json` tự nạp MCP server — rồi hỏi:

> dự án này có tài trợ không?

Agent gọi `check_project_sponsorship` (đọc `sponsored.json`, verify on-chain, không ký gì), rồi hỏi trước khi `claim_sponsored_grant`. Claim ghi `projectId` về `sponsored.json` và báo cho registry để tra cứu — cả hai đều **best-effort**, Grant thật nằm trên chain bất kể registry có ghi được hay không.

Chạy tay bằng CLI thì tương đương:

```bash
npm run cli -- init --campaign 0x… --sponsor <slug> --repo <repo-url> --chain 43113
npm run cli -- sponsorship         # đọc trạng thái, không ký
npm run cli -- claim-grant         # phát Grant cho ví hiện tại
```

Lệnh `init` ghi `sponsored.json` và `.mcp.json`; không ghi private key, API key hay ví developer. Contract từ chối một `projectId` đã từng nhận Grant — mỗi ví một Grant, fork lại không nhân bản được tiền.

Sau khi SupaDB có usage đủ 0.30 XSGD, developer có thể xin tranche kế tiếp — khác với `claim-grant` (phát Grant lần đầu), lệnh `claim` ở đây mở tranche tiếp theo của một Grant đã tồn tại:

```bash
CHAIN_ID=43113 GRANT_MANAGER=0x3230B5666d8De86d3079D07bb45A7075A1d0b043 \
PROJECT_ID=0xb34e1d43700c753c79fa98a98c434b921d9d3467e3f07f78ada83890ab8162bc \
npm run cli -- claim
```

Đã xác minh trên Fuji: transaction
[`0xb7b03fa8…c387c`](https://testnet.snowtrace.io/tx/0xb7b03fa8d4dde103d5daaf9584f7924b72e9974c55951dae239901f6c29c387c)
nhả tranche 2, nâng số dư đã vest của SupaDB Grant từ 0.50 lên 1.00 XSGD.

## Cảnh demo chặn

```bash
# merchant độc: challenge có prompt injection và đòi 30 XSGD
cd web && npm run dev:evil
```

Gọi endpoint độc qua `pay_for_service` phải bị checkpoint từ chối trước `unwrap`: sai `payTo`, vượt `max_amount`/per-tx cap. `npm run build` và `npm test` bao gồm giới hạn merchant, vesting, expiry, revoke, replay policy và binding authorization vào đúng invoice.

## Cần do người vận hành cung cấp

- AVAX Fuji cho signer (unwrap) và self-relayer (settlement).
- XSGD Fuji cho sponsor nạp campaign.
- Private key **chỉ** cho self-relayer trong `web/.env.local`; không commit file này.
- Self-relay là provider mặc định đã E2E với merchant `payTo` hiện tại. `0xgasless` chỉ nên bật sau khi verify thành công với đúng XSGD/Fuji/recipient; public facilitator hiện từ chối SupaDB demo recipient và docs không công bố quy trình whitelist.
- Ví owner của `MerchantRegistry` để duyệt merchant mới, trừ khi dùng auto-approve testnet (`RELAYER_PRIVATE_KEY` phải là chính ví owner đó; đặt `SPONSORED_AUTO_APPROVE_MERCHANTS=0` để tắt).
