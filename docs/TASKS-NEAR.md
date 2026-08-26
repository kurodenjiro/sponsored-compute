# TASKS — NEAR MVP, phân việc Opus / Sonnet

> Lộ trình: [ROADMAP-NEAR-MVP.md](ROADMAP-NEAR-MVP.md) · Cập nhật 26/08/2026
> Nền đã có: contract live testnet, 24 test Rust xanh, spike 9/9 bước ([§1 lộ trình](ROADMAP-NEAR-MVP.md))

---

## 1. Hai lớp công việc

| Class | Tính chất | Model |
|---|---|---|
| **A** | Sai là mất tiền hoặc mất tính chất bảo mật của kiến trúc. Cần suy luận sâu, ít ngữ cảnh ngoài. | **Opus** |
| **B** | Đã đặc tả rõ, khối lượng lớn, tra cứu tài liệu ngoài, lặp. | **Sonnet** |

Nguyên tắc phân: **cái gì quyết định "có được chi tiền hay không" là A.** Cái gì *thực thi* quyết định đó là B.

---

## 2. Hợp đồng tích hợp — đọc TRƯỚC khi ai code

Hai model code **đúng** các interface này. Không ai được đổi mà không báo.

### 2.1 Đã có sẵn trong repo — KHÔNG đổi

```ts
// src/core/types.ts
Grant { grantId, campaignId, repo, spender, homeChain, asset, spendableChains,
        spendableAssets, allowedPayees, total, released, spent, spentToday,
        perTxCap, dailyCap, expiry, revoked }
PaymentIntent { chain, asset, payTo, amount, scheme, transferMethod }

// src/core/policy.ts
evaluate({ intent, grant, callerMax, spender, allowedTransferMethods, now }) → Decision
```

### 2.2 ABI hợp đồng mới — CHỐT trước khi Wave 1 bắt đầu

```rust
// contract-near/src/evm.rs   (Opus)
request_evm_signature(campaign_id: String, to: String, amount: U128,
                      valid_before: U64, nonce: String) -> Promise
  // → EvmSignature { r: String, s: String, v: u8 }   r,s dạng "0x" + 64 hex
release_expired(grant_id: U64) -> U128        // permissionless; trả về số đã hoàn
sweep_evm(campaign_id: String, to: String, amount: U128) -> Promise   // sponsor, 1 yocto

// contract-near/src/lib.rs   (Opus)
get_grant_by_key(public_key: String) -> Option<Grant>
Campaign { …, evm_merchants: Vec<String> }     // ⚠️ MỚI — xem bên dưới
```

⚠️ `request_evm_signature` nhận **các trường rời**, không nhận payload hay hash. Xem §3 điều cấm 4.

🔴 **`merchants: Vec<AccountId>` KHÔNG dùng được cho merchant Base.** `AccountId` của NEAR không
biểu diễn được địa chỉ `0x…` một cách có nghĩa — nó *validate* qua vì hex thường là ký tự hợp lệ, rồi
sẽ nổ khi ai đó lỡ đưa vào `ft_transfer`. Campaign cần **hai allowlist tách biệt**:
`merchants: Vec<AccountId>` cho chân NEAR và `evm_merchants: Vec<String>` cho chân Base, cùng
`set_evm_merchants`. `Grant.allowedPayees` phía TS đã đúng hình dạng `(chain, address)` để nhận cả hai.

### 2.3 🔴 Điểm hẹn giữa hai model — test vector EIP-712

Đây là ranh giới bàn giao quan trọng nhất. Sonnet **sinh** vector bằng `viem`; Opus **tiêu thụ** vector trong test Rust. Không ai phải đọc code của bên kia.

```jsonc
// contract-near/tests/fixtures/eip712.json   — Sonnet sở hữu file này
[{
  "label": "base-mainnet-1usdc",
  "chainId": 8453,
  "verifyingContract": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "domainName": "USD Coin",          // ⚠️ Sepolia là "USDC" — xem §4.2 lộ trình
  "domainVersion": "2",
  "from": "0x…", "to": "0x…", "value": "1000000",
  "validAfter": "0", "validBefore": "1780000000",
  "nonce": "0x…",
  "digest": "0x…"                     // viem tính; Rust phải ra ĐÚNG chuỗi này
}]
```

Phải có tối thiểu 4 case: mainnet + Sepolia × (amount nhỏ, amount lớn có leading zero).

### 2.3b Hình dạng x402 v2 — đã bắt được từ 402 thật (26/08/2026)

Không phải suy đoán. Chụp từ `https://x402.org/protected`:

```jsonc
{ "x402Version": 2, "error": "Payment required",
  "resource": { "url": "…", "description": "…", "mimeType": "" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",   // CAIP-2; v2 BỎ hẳn trường chainId số
    "amount": "10000",            // v1 gọi là maxAmountRequired
    "asset": "0x036CbD53…", "payTo": "0x209693…",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USDC", "version": "2" }   // domain EIP-712, KHÔNG có assetTransferMethod
  }]}
```

Đã hiện thực trong [`src/base/x402.ts`](../src/base/x402.ts).

**Payload gửi đi: KHÔNG tự ráp — đã chuyển sang SDK chính thức** (`@x402/core` + `@x402/evm` +
`@x402/fetch`, v2.23). Tài liệu của `ExactEvmScheme` nói thẳng: *"Base flow only requires `address` +
`signTypedData`"* — đúng hai method, và đó là chỗ cắm contract vào.

🔴 **Hệ quả về vị trí checkpoint.** `wrapFetchWithPayment` tự trả lời 402, nên checkpoint **không thể**
nằm trong luồng request — nó nằm **bên trong `signTypedData`**. Không transport nào vòng qua được.
Và vị trí đó *chặt hơn* kiểm challenge: byte đưa vào `signTypedData` chính là byte sắp được ký, nên
merchant quảng cáo một giá rồi lái SDK ký giá khác sẽ bị bắt. Challenge là lời khai; typed data là vật chứng.

Ba lớp độc lập cùng ép trần: `spendControls` của SDK · checkpoint trên chính typed data ·
`grant-manager.near` dựng lại digest từ state của nó.

### 2.4 TS mới

```ts
// src/near/evm.ts   (Sonnet)
deriveCampaignAddress(grantManager: string, campaignId: string): `0x${string}`
// suy tất định từ v1.signer.derived_public_key — không có private key ở đâu cả

// src/near/config.ts   (Sonnet) — thêm
BASE_NETWORKS: Record<8453 | 84532, { rpc, usdc: { address, eip712: { name, version } }, facilitator }>
```

### 2.5 MCP tools — chốt cứng, đúng năm cái

```ts
list_sponsored_platforms(category)   // đọc
check_project_sponsorship()          // đọc
get_grant_status()                   // đọc
claim_sponsored_grant()              // tác động ngoài — cần user duyệt
pay_for_service(url, max_amount)     // tác động ngoài — cần user duyệt
```

---

## 3. 🔴 Bảy điều CẤM — vi phạm là hỏng kiến trúc, không phải hỏng code

1. **Không expose `evaluate` / `checkpoint` / `request_evm_signature` thành MCP tool.** Checkpoint nằm **bên trong** `pay_for_service`.
2. **Không tool nào trả private key hay secret.** Không `sign_anything`.
3. **Không claim grant trong `postinstall`** — chỉ được in một dòng.
4. **Contract KHÔNG BAO GIỜ ký một payload/hash do caller đưa vào.** Nhận trường rời, tự dựng digest. Nhận hash mờ nghĩa là agent bảo contract ký gì cũng được, kể cả lệnh chuyển sạch số dư.
5. **Không tạo ví Base riêng ở bất kỳ đâu** — không awal, CDP, Privy, Turnkey, raw key. Địa chỉ Base **chỉ** được suy ra từ `(grant-manager, path)`.
6. **Không gộp nhiều action vào một transaction của sponsor.** NEP-518 không batch được; ví EVM sẽ tách thành nhiều tx chạy lần lượt.
7. **Không build contract bằng `cargo build` trực tiếp** — luôn qua `npm run near:build`. Thiếu `--cfg near` thì mọi thông điệp `require!` bị nuốt thành wasm trap.

---

## 4. Sở hữu file — tránh xung đột merge

| Model | Sở hữu |
|---|---|
| **Opus** | `contract-near/src/**` · `src/core/**` · mọi `#[test]` trong `contract-near/tests/*.rs` |
| **Sonnet** | `src/near/**` · `src/x402.ts` · `mcp/**` · `src/cli.ts` · `web/**` · `scripts/**` · `contract-near/tests/fixtures/**` · `contract-near/mock-ft/**` · `.github/workflows/**` |

Quy tắc khi cần chạm sang phần của bên kia: **mở task mới, đừng sửa tại chỗ.**

---

## 5. Wave 0 — bịt lỗ đúng đắn *(giai đoạn 01, ~4 ngày)*

| # | Task | Class | Model | Ngày | Deps |
|---|---|---|---|---|---|
| 0.1 | ~~`contract-near/mock-ft/` + harness `near-workspaces`~~ ✅ **xong** — workspace 2 crate, `near-workspaces 0.23` | B | — | 0 | — |
| 0.2 | ~~🔴 Test rollback `on_paid`~~ ✅ **xong** — `tests/sandbox.rs`, 4 test. Đường rollback giờ có test thật | A | — | 0 | 0.1 |
| 0.3 | ~~`storage_deposit` preflight trong `set_merchants`~~ ✅ **xong** — có test sandbox, đã deploy testnet | A | — | 0 | 0.1 |
| 0.4 | ~~View `get_grant_by_key`~~ ✅ **xong** — `src/views.rs`, +2 test, đấu vào `NearGrantSource.byKey()` và `near-agent status` (không cần campaign/repo) | A | — | 0 | — |
| 0.5 | ~~CI guard `panic_utf8`~~ ✅ **xong** — `npm run ci:guards` + `.github/workflows/ci.yml`. Gộp luôn **task 1.10** (không có khoá EVM). Đã negative-test | B | — | 0 | — |
| 0.6 | 🚦 **Spike ví thirdweb → NEAR.** thirdweb in-app wallet (**EOA, tắt account abstraction**) → wagmi adapter → `@near-wallet-selector/ethereum-wallets` → ký `set_paused` **kèm 1 yoctoNEAR** trên testnet | B | Sonnet | 1.5 | — |
| 0.7 | ~~Sinh `tests/fixtures/eip712.json`~~ ✅ **xong** — `npm run fixtures`, 4 vector (mainnet/Sepolia × amount nhỏ/uint256 max) | B | — | 0 | — |

> **0.6 là cổng, và giờ nó gánh nhiều rủi ro hơn.** Hai cách trượt:
> ① smart account ERC-4337 phát ra UserOperation chứ không phải tx Ethereum đã ký, mà NEP-518 cần cái
> sau — nên **phải dùng in-app wallet EOA, tắt account abstraction**;
> ② `ethereum-wallets` không gắn được 1 yoctoNEAR cho `assert_one_yocto`.
> Trượt cái nào cũng phải đổi mặc định sang `meteor-wallet` **trước khi** xây UI lên trên.
> Đừng để phát hiện ở Wave 3.

---

## 6. Wave 1 — chân Base *(giai đoạn 02, ~1.5 tuần — ĐƯỜNG TỚI HẠN)*

| # | Task | Class | Model | Ngày | Deps |
|---|---|---|---|---|---|
| 1.1 | ~~`evm.rs` dựng digest EIP-712~~ ✅ **xong** — [`src/evm.rs`](../contract-near/src/evm.rs), 6 test ở `tests/eip712.rs` khớp bit-đối-bit cả 4 vector | A | — | 0 | 0.7 |
| 1.2 | ~~`request_evm_signature`~~ ✅ **xong** — nhận trường rời, contract tự dựng digest. Đã ký thật qua `v1.signer-prod.testnet` | A | — | 0 | 1.1 |
| 1.3 | ~~Ráp chữ ký MPC + chuẩn hoá EIP-2~~ ✅ **xong** — `npm run base:sign` chứng minh `ecrecover` ra đúng địa chỉ phái sinh trên testnet thật | A | — | 0 | 1.2 |
| 1.4 | ~~`reserved` + release~~ ✅ **xong** — ⚠️ **thiết kế đổi so với kế hoạch**, xem ghi chú dưới bảng | A | — | 0 | 1.2 |
| 1.5 | ~~`sweep_evm`~~ ✅ **xong** — sponsor ký lệnh chuyển qua cùng đường ký | A | — | 0 | 1.2 |
| 1.6 | ~~Test tấn công~~ ✅ **xong** — 6 test sandbox mới, tất cả bị từ chối **trước khi** chạm tới signer | A | — | 0 | 1.4 |
| 1.7 | ~~`BASE_NETWORKS` registry~~ ✅ **xong 26/08** — [`src/base/config.ts`](../src/base/config.ts), domain verify live cả hai mạng | B | — | 0 | — |
| 1.8 | ~~`deriveCampaignAddress()`~~ ✅ **xong 26/08** — [`src/base/address.ts`](../src/base/address.ts) | B | — | 0 | — |
| 1.9 | ~~Luồng x402 Base phía agent~~ ✅ **xong 26/08** — [`src/base/pay.ts`](../src/base/pay.ts) trên SDK v2 chính thức, checkpoint nằm trong `signTypedData`, 18 test ở [`signer.test.ts`](../src/base/signer.test.ts). Còn lại **chỉ là cài `EvmSignatureRequester`** bằng `request_evm_signature` (task 1.2) | B | — | 0 | 1.3 |
| 1.9b | ~~Nối requester thật~~ ✅ **xong** — [`src/near/evm-requester.ts`](../src/near/evm-requester.ts). Facilitator thật đã **chấp nhận chữ ký** (`invalid_exact_evm_insufficient_balance` = hợp lệ, chỉ thiếu tiền). Còn lại: bật `spendControls` của SDK | B | Sonnet | 0.25 | — |
| 1.10 | **Test CI: không tồn tại địa chỉ Base ngoài phái sinh** — grep repo tìm private key / ví Base, fail build | B | Sonnet | 0.5 | 1.8 |
| 1.11 | ⏳ **Chỉ còn nạp tiền.** `npm run base:probe -- <url> --real <campaign> <repo>` chạy hết luồng thật; facilitator xác nhận chữ ký hợp lệ. Cần USDC Base Sepolia vào địa chỉ phái sinh của campaign (`npm run near:agent -- evm-address <campaign>`) | B | người | — | — |

> **🚦 Cổng MVP:** trả được cho một merchant x402 **có thật** trên Base Sepolia bằng grant sống trên NEAR, và 1.10 xanh.
> **Trạng thái:** mọi mắt xích đã thông, chỉ còn nạp USDC. Facilitator thật trả
> `invalid_exact_evm_insufficient_balance` — tức chữ ký **đã qua khâu xác minh**.

### 🔴 Đổi thiết kế ở 1.4 — release **không** được permissionless

Kế hoạch ban đầu cho `release_expired` ai gọi cũng được, lập luận: quá hạn thì chữ ký EIP-3009 chết
theo nên không double-spend được. Đúng với **một** chữ ký, và vẫn sai khi cộng dồn:

> xin ký → submit → để quá hạn → release → lặp lại. Mỗi lần đều settle, không lần nào bị tính, và
> campaign cạn tiền trong khi sổ cái đọc ra số 0.

Chỉ ai nhìn được Base mới biết reservation nào thật sự hỏng, và sponsor vừa là bên đó vừa là bên mất
tiền. Nên `release_reservation` **chỉ sponsor gọi được**, và mặc định an toàn là *không làm gì*:
reservation không được release thì vẫn tính là đã tiêu.

Ngoại lệ duy nhất tự release: **vòng ký thất bại**. Lúc đó chắc chắn không có chữ ký nào ra đời, nên
callback trả tiền lại ngay mà không cần ai xác nhận.

**Ba phát hiện khác của Wave 1:**

1. **`GRANT_METHODS` là biên giới bảo mật, không phải danh sách tiện lợi.** Thêm
   `request_evm_signature` vào đó nới quyền cho **mọi** grant đang tồn tại. Access key từ chối method
   lạ ở tầng runtime — test đầu tiên fail đúng vì lý do này, và đó là hệ thống hoạt động đúng.
2. **Đoán MPC signer theo hậu tố account là sai.** Sandbox dùng `*.test.near`, kết thúc bằng `.near`,
   nên logic cũ chọn nhầm mainnet. Signer giờ là state, đặt lúc `new()` — vừa test được vừa không
   đoán mò.
3. **`cargo test` không build lại wasm.** Sandbox nạp file `release/` cũ, nên sửa contract xong chạy
   `cargo test` thẳng sẽ test nhầm bản cũ. Luôn dùng `npm run near:test`, nó build trước.

---

## 7. Wave 2 — hợp chuẩn v2 và phòng thủ *(giai đoạn 03, ~4 ngày)*

| # | Task | Class | Model | Ngày | Deps |
|---|---|---|---|---|---|
| 2.1 | **Rà `src/x402.ts` theo x402 v2** — payload, không chỉ tên header. Xoá ghi chú "phi chuẩn StraitsX" đã sai | B | Sonnet | 1 | 1.9 |
| 2.2 | ~~Rate limit theo merchant~~ ✅ **xong** — `maxPerMerchantPerHour`, fail-closed khi thiếu history, 6 test | A | — | 0 | — |
| 2.3 | **Xử lý facilitator verify ≠ settle** — không coi `verify` là thành công; đối soát log `Transfer` trên Base | B | Sonnet | 1 | 1.11 |
| 2.4 | `Campaign.verifier` + `claim_grant(owner)` chỉ nhận từ verifier/sponsor (~10 dòng) | A | **Opus** | 0.5 | — |
| 2.5 | **Verifier repo do sponsor chạy** — GitHub OIDC hoặc commit chứa nonce | B | Sonnet | 1 | 2.4 |
| 2.6 | Test merchant độc hại prompt-inject trên đường Base | B | Sonnet | 0.5 | 1.9 |

---

## 8. Wave 3 — dùng được *(giai đoạn 04, ~1.5 tuần)*

| # | Task | Class | Model | Ngày | Deps |
|---|---|---|---|---|---|
| 3.1 | **5 MCP tool trỏ NEAR**; `pay_for_service` tự chọn đường NEAR/Base theo challenge | B | Sonnet | 1.5 | 1.9 |
| 3.2 | **Bước đồng ý** — permission prompt hiện **đúng** merchant + amount thật, không phải giá trị LLM diễn giải | A | **Opus** | 0.5 | 3.1 |
| 3.3 | **Console sponsor trên Wallet Selector** — 4 module, `ethereum-wallets` mặc định | B | Sonnet | 2 | 0.6 |
| 3.4 | Màn nạp: địa chỉ Base của campaign + QR + số dư | B | Sonnet | 1 | 1.8 |
| 3.5 | `cli init` → `sponsored.json` + `.mcp.json` | B | Sonnet | 0.5 | 3.1 |
| 3.6 | Cảnh báo 80% / 95%; hết trần → **dừng dịch vụ** | B | Sonnet | 0.5 | 3.1 |
| 3.7 | 4 màn Tailwind, giữ `--sc-accent: #c8ff45`, responsive + dark/light | B | Sonnet | 2 | 3.3 |

---

## 9. Wave 4 — phát hành *(giai đoạn 05, ~1 tuần)*

| # | Task | Class | Model | Ngày | Deps |
|---|---|---|---|---|---|
| 4.1 | **Deploy mainnet** + campaign nhỏ tiền thật | A | **Opus** | 0.5 | tất cả |
| 4.2 | Merchant x402 thật trên **Base mainnet** (§4.4 bước 4) | B | Sonnet | 0.5 | 4.1 |
| 4.3 | `architecture.drawio` + README + docs | B | Sonnet | 1 | 4.2 |
| 4.4 | Video 3 phút — trục chính là màn thu hồi | — | **người** | 1 | 4.2 |

---

## 10. Đường tới hạn & thứ tự cắt

```
0.7 ──▶ 1.1 ──▶ 1.2 ──▶ 1.3 ──▶ 1.9 ──▶ 1.11 ──▶ 🚦 CỔNG MVP
                  └────▶ 1.4 ──▶ 1.6
0.1 ──▶ 0.2 / 0.3
0.6 ────────────────────────────────────▶ 3.3      (spike sớm, dùng muộn)
```

**Cắt theo thứ tự nếu thiếu ngày:** 3.7 (chất lượng UI) → 3.4 → 2.5 → 2.3 → 1.5

**KHÔNG BAO GIỜ CẮT:**
- **1.1** — contract tự dựng digest. Cắt nó là mở cửa "ký gì cũng được" (§3 điều cấm 4)
- **1.4** — reservation. Cắt nó là để merchant đốt grant mà không settle
- **1.10** — test không có ví Base. Cắt nó là mất tiêu chí 2 của định nghĩa hoàn thành
- **2.2 / 3.2** — rate limit và bước đồng ý. Đây là linh hồn dự án, giống 2.1/2.3 của bản Avalanche

---

## 11. Định nghĩa "xong" cho các task quan trọng

| # | Xong nghĩa là |
|---|---|
| 0.2 | Test: merchant chưa đăng ký storage → `pay_merchant` → `spent` và `spent_today` **về đúng giá trị trước đó**, `settled=false` |
| 0.3 | `set_merchants` với account chưa `storage_deposit` → **panic có thông điệp**, không phải wasm trap |
| 0.6 | Screenshot MetaMask ký `set_paused`, và `get_campaign` trả `paused: true` trên testnet |
| 1.1 | `cargo test` xanh với **cả 4 case** trong `eip712.json`, gồm cả case Sepolia (`name: "USDC"`) |
| 1.2 | Testnet: gọi `request_evm_signature` trả về chữ ký; `ecrecover` cho ra đúng địa chỉ mà `deriveCampaignAddress()` tính |
| 1.4 | Test: xin ký rồi không submit → sau hạn `release_expired` → `released - spent` về đúng như trước |
| 1.6 | Cả 4 kịch bản tấn công đều **panic có thông điệp nêu đúng lý do**, không cái nào cấp được chữ ký |
| 1.9 | Endpoint 402 thật trên Base Sepolia trả 200 sau khi retry, và merchant nhận đúng số USDC |
| 1.10 | CI fail khi cố tình thêm một private key Base vào repo |
| 3.2 | Prompt hiện đúng `merchant` và `amount` lấy **từ challenge đã qua checkpoint**, không phải từ text LLM sinh ra |
| 4.1 | Demo thu hồi chạy trên mainnet: `DeleteKey` → cả chân NEAR và chân Base dừng, tx công khai trên Nearblocks |

---

## 12. Tải công việc

| Model | Ngày | Task |
|---|---|---|
| Sonnet | **19.25** | 21 |
| Opus | 9.75 | 13 |
| người | 1 | 1 |
| | **30** | **35** |

Chạy song song thì thời gian thực = luồng dài nhất ≈ **19 ngày công của Sonnet**, khớp với "≈5 tuần" của lộ trình.

**Sonnet là nút cổ chai, không phải Opus.** Nếu chạy được hai instance Sonnet song song thì tách theo thư mục: một instance giữ `web/**` + `mcp/**` (Wave 3), một instance giữ `src/near/**` + `scripts/**` (Wave 1–2). Hai nhóm này không đụng file nhau.

Ngược lại, **đừng tách Opus ra nhiều instance**: 13 task của Opus gần như nối tiếp trên cùng một file `evm.rs`, tách ra chỉ tạo xung đột merge.

---

## 13. Ghi chú vận hành cho cả hai model

- Contract build: `npm run near:build` · test: `npm run near:test` · deploy: `npm run near:deploy`
- Spike end-to-end: `CAMPAIGN=<mới> REPO=<mới> npm run near:spike` — **campaign và repo phải mới**, vì `revoke_grant` ở bước 9 xoá key
- Testnet NEAR: `gm.anyone3-pay.testnet` · token `usdc.fakes.testnet` · sponsor `anyone3-pay.testnet` · merchant `anyone-pay.testnet`
- **Merchant x402 thật để nhắm vào từ task 1.11** *(đã tìm được 26/08)*:
  `https://x402.org/protected` — Base Sepolia, `eip155:84532`, 0.01 USDC,
  payTo `0x209693Bc6afc0C5328bA36FaF03C514EF312287C`. Facilitator public `https://x402.org/facilitator`,
  miễn phí, không cần API key
- Base: mặc định Sepolia (`BASE_CHAIN_ID=84532`)
- ⚠️ **Facilitator là phụ thuộc của bên BÁN, không phải bên mua.** Resource server mới là bên gọi
  `/verify` và `/settle`; agent chỉ ký rồi gửi `PAYMENT-SIGNATURE`. Nên trả tiền cho merchant thật trên
  Base mainnet **không cần** facilitator nào của ta. `X402_FACILITATOR` chỉ để chạy `merchant-demo/`
- Test TS: `npm test` (policy 22 + keystore 7 + signer 18 + contract 24)
- Merchant của ta: `MERCHANT_PAYTO=0x… npm run merchant` → `GET /quote` trả 402 thật, `GET /health` miễn phí.
  Đối chiếu bằng `npm run base:probe -- http://localhost:4041/quote`
- ⚠️ Phía server phải **đăng ký scheme tường minh**: `[{ network, server: new ExactEvmScheme() }]`.
  Thiếu nó thì route trả 500 `missing_scheme`, không phải 402 — dễ tưởng là lỗi client
- Mint thêm USDC test: `near contract call-function as-transaction usdc.fakes.testnet mint json-args '{"account_id":"…","amount":"…"}' …`
