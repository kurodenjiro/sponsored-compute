# TASKS — phân việc đa model

> Kế hoạch: [SPONSORED-COMPUTE.md](SPONSORED-COMPUTE.md) · Cập nhật 15/08/2026
> **Deadline: 16/08.** Ước còn ~18h hiệu dụng.

⚠️ Tôi không biết **Gpt-sol** và **gpt-luna** mạnh ở mảng nào — phân dưới đây dựa trên **tính chất công việc**, không dựa trên đặc tính model. Đổi cột `Model` thoải mái, phần `Class` và `Deps` mới là cái phải giữ.

---

## 1. Bốn lớp công việc

| Class | Tính chất | Gợi ý |
|---|---|---|
| **A** | An toàn/đúng đắn là sống còn. Sai là mất tiền hoặc thua giải. Cần suy luận sâu, ít ngữ cảnh ngoài. | **Opus 5** |
| **B** | Đã đặc tả rõ, khối lượng lớn, lặp. | **Sonnet** |
| **C** | Tra cứu ngoài, xác minh, đọc docs, probe API. | **Gpt-sol** |
| **D** | Demo, slide, docs, script, UI. | **gpt-luna** |

---

## 2. Hợp đồng tích hợp — đọc TRƯỚC khi ai code

Mọi agent code **đúng** các interface này. Không ai được đổi mà không báo.

**Đã có sẵn trong repo** (`src/config.ts`, `src/signer.ts`, `src/x402.ts`):
```ts
interface Signer { address(): Promise<`0x${string}`>;
                   signTypedData(d: TypedDataDefinition): Promise<`0x${string}`>; }

getNetwork(chainId) → { chainId, caip2, rpc, explorer, facilitator, tokens }
parseChallenge(res: Response) → Challenge
signPayment(signer, req, opts) → { authorization, signature }
buildPaymentPayload(req, authorization, signature) → object
encodePaymentHeader(payload) → string
```

**MCP tools — chốt cứng, chỉ ba cái:**
```ts
list_sponsored_platforms(category: string)
get_grant_status()
pay_for_service(url: string, max_amount: string)
```

**Hằng số** — lấy từ `src/config.ts`, **cấm hardcode ở nơi khác**:
`XSGD Fuji 0xd769410dc8772695a7f55a304d2125320a65c2a5` · 6 decimals · EIP-712 `{name:"XSGD", version:"2"}` · facilitator `https://x402.0xgasless.com` · chainId `43113`

### 🔴 Ba điều CẤM — vi phạm là hỏng dự án
1. **Không expose `unwrap` / `sign` / `check_policy` thành MCP tool.** Checkpoint nằm **bên trong** `pay_for_service`. (§6 Luật 1)
2. **Không tool nào trả về private key.** Không `sign_anything`.
3. **Không claim Grant trong `postinstall`** — chỉ được in một dòng.

### Sở hữu thư mục — tránh xung đột merge
| Agent | Sở hữu |
|---|---|
| Opus 5 | `contracts/` · `src/checkpoint.ts` · `src/x402.ts` |
| Sonnet | `src/mcp/` · `src/card.ts` · `src/cli.ts` |
| Gpt-sol | `docs/verify/` · không sửa `src/` |
| gpt-luna | `platform-demo/` · `slides/` · `sponsored-template/` |

---

## 3. Wave 0 — chạy NGAY, song song, không chờ ai

| # | Task | Class | Model | Giờ |
|---|---|---|---|---|
| 0.1 | 🔴 **Xin XSGD testnet từ BTC** — submit địa chỉ ví. Blocker duy nhất, không tự giải được | — | **người** | — |
| 0.2 | Chạy `npm i` → `npm run address` → lấy địa chỉ ví cho 0.1 | B | Sonnet | 0.2 |
| 0.3 | Nạp **Fuji AVAX** từ faucet vào ví đó (gas cho `unwrap`) | D | gpt-luna | 0.2 |
| 0.4 | Verify **status ERC-7291** (Draft/Review/Final) + tìm reference implementation | C | Gpt-sol | 0.5 |
| 0.5 | Verify **cú pháp MCP config của Codex CLI** — viết ra file mẫu chạy được | C | Gpt-sol | 0.5 |
| 0.6 | Chốt **relayer nào chính thức** (`/health` báo `0x4B9E…` ≠ `/list` báo `0x8BD6…`) | C | Gpt-sol | 0.3 |
| 0.7 | Chụp màn hình chuỗi injection trong `get_card_sandbox` → slide #1 | D | gpt-luna | 0.3 |

---

## 4. Wave 1 — nền móng, song song theo thư mục

| # | Task | Class | Model | Giờ | Deps |
|---|---|---|---|---|---|
| 1.1 | 🔴 **`src/card.ts` + `src/cli.ts`** → ký EIP-3009 → `POST /verify` lên facilitator. **Không chờ token** — `/verify` chỉ kiểm chữ ký | A | **Opus 5** | 1 | — |
| 1.2 | **`MerchantRegistry.sol`** + **`GrantManager.sol`** (unwrap + caps + expiry + `_checkUnwrap`) | A | **Opus 5** | 3 | — |
| 1.3 | **`SponsorPool.sol`** + `issueGrant` + tranche 1 | A | **Opus 5** | 2 | 1.2 |
| 1.4 | **`platform-demo/`** — Express + `x402-express` trỏ `x402.0xgasless.com`, asset XSGD | B | Sonnet | 0.5 | — |
| 1.5 | **`sponsored-template/`** — `sponsored.json` + `.mcp.json` + `postinstall` chỉ in | D | gpt-luna | 0.5 | — |
| 1.6 | Script Foundry cho sponsor: `RegisterMerchant` · `Fund` · `CreateCampaign` (§8.1 Tier 0) | B | Sonnet | 0.75 | 1.3 |

> **1.1 là việc quan trọng nhất Wave 1.** Payload `PAYMENT-SIGNATURE` **không có tài liệu** (§13.3) — nếu server từ chối, phải suy ra hình dạng đúng. Đó là lý do giao Class A.

---

## 5. Wave 2 — MCP server (đường tới hạn)

| # | Task | Class | Model | Giờ | Deps |
|---|---|---|---|---|---|
| 2.1 | 🔴 **`src/checkpoint.ts`** — logic quyết định có ký hay không. **KHÔNG CẮT** | A | **Opus 5** | 1 | 1.1, 1.2 |
| 2.2 | **`src/mcp/`** — MCP server + 3 tool, stdio transport | B | Sonnet | 2 | 2.1 |
| 2.3 | Bước đồng ý — permission prompt hiện đúng tham số thật. **KHÔNG CẮT** | A | **Opus 5** | 0.75 | 1.3 |
| 2.4 | `sponsored.json` → resolve campaign on-chain, từ chối `projectId` đã dùng | B | Sonnet | 1 | 1.3, 2.2 |
| 2.5 | DynamoDB atomic claim `(pay_id, resource_id)` chống replay | B | Sonnet | 0.5 | 1.4 |

---

## 6. Wave 3 — hoàn thiện & demo

| # | Task | Class | Model | Giờ | Deps |
|---|---|---|---|---|---|
| 3.1 | `claimTranche` + `confirmSettlement` (vesting theo dấu vết on-chain) | A | **Opus 5** | 2 | 1.3, 2.2 |
| 3.2 | Cầu nối thẻ StraitsX (`get_card_sandbox` → 402 → ký → thẻ) | B | Sonnet | 1.5 | 1.1 |
| 3.3 | CloudTrail/CloudWatch + **slide kiến trúc AWS 6 pillar** | D | gpt-luna | 1 | 2.2 |
| 3.4 | **Slide deck** — mở bằng chuỗi injection (0.7), có bảng so Crossmint Scopes (§12.1) | D | gpt-luna | 1.5 | — |
| 3.5 | **Script demo 90s** + tập chạy ≥3 lần | D | gpt-luna | 1 | tất cả |
| 3.6 | Seed dữ liệu: **2 sponsor · 3 platform** (bắt buộc — §1) | B | Sonnet | 0.5 | 1.6 |

---

## 7. Đường tới hạn & thứ tự cắt

```
0.1 (người) ──────────────────────────────┐
1.1 ──▶ 2.1 ──▶ 2.2 ──▶ 3.5               │ cần token để settle thật
1.2 ──▶ 1.3 ──▶ 2.3 ──────▶ 3.1           │ (nhưng /verify chạy được ngay)
```

**Cắt theo thứ tự nếu thiếu giờ:** 3.2 → 3.1 (vesting để slide) → 3.3 → 2.5 → 2.4
**KHÔNG BAO GIỜ CẮT:** 2.1 (checkpoint) và 2.3 (bước đồng ý) — là linh hồn dự án.

---

## 8. Định nghĩa "xong" cho các task quan trọng

| # | Xong nghĩa là |
|---|---|
| 1.1 | `npm run card` in ra `card_opaque_id` + `settlement_tx`, **hoặc** `/verify` trả `valid:true` nếu chưa có token |
| 1.2 | `forge test` xanh, gồm test: unwrap sai merchant **revert** · vượt cap **revert** · hết hạn **revert** |
| 2.1 | Có test: 402 kèm chuỗi injection → checkpoint vẫn **từ chối**, không ký |
| 2.2 | `claude mcp add` xong, hỏi trong Claude Code thật ra được danh sách platform |
| 2.3 | Permission prompt hiện **đúng** `platform` và `amount` thật, không phải giá trị do LLM diễn giải |
| 3.5 | Chạy trọn 10 bước §11 không lỗi, **3 lần liên tiếp** |

---

## 9. Nhắc mỗi agent trước khi bắt đầu

- **Opus 5** — đọc §3 (ràng buộc ERC-1271), §6 (hai luật), §7.1 (contracts). Payload `PAYMENT-SIGNATURE` chưa có tài liệu, cô lập trong `buildPaymentPayload()`.
- **Sonnet** — đọc §2 hợp đồng tích hợp trong file này. Không hardcode địa chỉ; mọi thứ qua `getNetwork()`.
- **Gpt-sol** — chỉ ghi vào `docs/verify/`. Mỗi phát hiện ghi kèm **nguồn + ngày**. Nếu mâu thuẫn với SPONSORED-COMPUTE.md thì **báo, đừng tự sửa**.
- **gpt-luna** — demo phải có **≥2 sponsor và ≥3 platform**, nếu không dự án tự chứng minh mình không cần blockchain (§1).
