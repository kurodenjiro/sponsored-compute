# AGENTS.md — bàn giao cho agent tiếp theo

> Đọc file này trước khi sửa gì. Nó chứa thứ **không** đọc ra được từ code:
> những chỗ đã thử và sai, và những chỗ trông có vẻ vô hại nhưng phá kiến trúc.
>
> Kế hoạch: [docs/ROADMAP-NEAR-MVP.md](docs/ROADMAP-NEAR-MVP.md) ·
> Bảng việc: [docs/TASKS-NEAR.md](docs/TASKS-NEAR.md) ·
> Contract: [contract-near/README.md](contract-near/README.md)

---

## 1. Dự án làm gì — một câu

Sponsor nạp campaign trên NEAR. Agent của developer claim grant gắn với repo, rồi
trả tiền cho merchant x402 trên Base **bằng địa chỉ mà chính hợp đồng NEAR kiểm
soát**. Sponsor xoá một access key là cả hai chân dừng.

Điểm mấu chốt: **không tồn tại private key EVM ở bất kỳ đâu.** Địa chỉ Base suy
ra từ `(grant-manager, "campaign-<id>")` qua Chain Signatures, và chỉ contract ký
được cho nó — sau khi kiểm lại toàn bộ trần chi.

---

## 2. Trạng thái

| | |
|---|---|
| Contract testnet | [`gm.anyone3-pay.testnet`](https://testnet.nearblocks.io/address/gm.anyone3-pay.testnet), MPC signer `v1.signer-prod.testnet` |
| Test | 95 xanh — 53 TS, 42 Rust (gồm 10 sandbox `near-workspaces`) |
| Chân NEAR | ✅ chạy thật: `npm run near:spike`, 9/9 bước |
| Chân Base | ✅ ký thật, `ecrecover` khớp địa chỉ phái sinh; facilitator thật đã **chấp nhận chữ ký** |
| Wave 0, Wave 1 | ✅ xong |

Bằng chứng mạnh nhất, chạy lại được bất cứ lúc nào:

```bash
npm run base:sign -- evm1 github.com/kurodenjiro/evm1
#   recovered 0x20b28B70AfD5AAD5534F44Cf3e8503D83414c3DF
#   expected  0x20b28B70AfD5AAD5534F44Cf3e8503D83414c3DF
#   ✓ the contract signs for the address it derives
```

---

## 3. Việc còn lại, theo thứ tự

### 🚦 Cổng MVP — chỉ còn nạp tiền *(cần người, không tự động hoá được)*

Mọi mắt xích đã thông. Facilitator thật trả `invalid_exact_evm_insufficient_balance`
— tức chữ ký **đã qua khâu xác minh**, chỉ thiếu USDC.

```bash
npm run near:agent -- evm-address evm1   # → địa chỉ cần nạp
# nạp USDC Base Sepolia vào đó, rồi:
npm run base:probe -- https://x402.org/protected --real evm1 github.com/kurodenjiro/evm1
```

Xong bước này là đạt cổng MVP.

### 0.6 — spike ví thirdweb → NEAR *(cần trình duyệt, treo từ Wave 0)*

thirdweb in-app wallet (**EOA, tắt account abstraction**) → wagmi adapter →
`@near-wallet-selector/ethereum-wallets` → ký `set_paused` **kèm 1 yoctoNEAR**.

Rủi ro chính: ERC-4337 phát ra UserOperation, còn NEP-518 cần một transaction
Ethereum RLP **đã ký**. Nếu trượt, đổi mặc định sang `meteor-wallet` **trước khi**
Wave 3 dựng console — đừng để phát hiện lúc đó.

### Wave 2 — còn 3 việc

| # | Việc | Ghi chú |
|---|---|---|
| 2.1 | Rà `src/base/x402.ts` theo x402 v2 | Header đã đúng; còn payload |
| 2.3 | Xử lý facilitator verify ≠ settle | Đối soát log `Transfer` trên Base |
| 2.4 | `Campaign.verifier` + `claim_grant(owner)` | ~10 dòng, mở đường bỏ ví cho developer |
| 2.5 | Verifier repo do sponsor chạy | GitHub OIDC hoặc commit chứa nonce |
| 2.6 | Test merchant độc hại prompt-inject | Khung đã có |

### Wave 3–4 — xem [docs/TASKS-NEAR.md](docs/TASKS-NEAR.md)

MCP 5 tool · `cli init` · console sponsor trên Wallet Selector · 4 màn · mainnet.

---

## 4. 🔴 Bất biến — phá là hỏng kiến trúc, không phải hỏng code

1. **Contract không bao giờ ký một hash/payload do caller đưa vào.** Nhận trường
   rời, tự dựng digest. Hash thì không soi được: "trả merchant 1 USDC" và "chuyển
   sạch số dư" trông giống hệt nhau lúc đi vào.
2. **Không tạo ví EVM riêng ở bất kỳ đâu** — không CDP, Privy, Turnkey, awal, raw
   key. `npm run ci:guards` fail build nếu thấy. Đây là thứ khiến `DeleteKey` chặn
   được cả chân Base.
3. **Checkpoint nằm trong `signTypedData`, không nằm trong luồng request.**
   `wrapFetchWithPayment` tự trả lời 402 — đặt checkpoint ở luồng request là để
   nó bị vòng qua. Vị trí hiện tại còn chặt hơn: nó kiểm trên chính byte sắp ký,
   không phải trên lời khai trong challenge.
4. **`GRANT_METHODS` là biên giới bảo mật, không phải danh sách tiện lợi.** Thêm
   một method là nới quyền cho **mọi** grant đang tồn tại.
5. **Không expose `evaluate` / `request_evm_signature` thành MCP tool.** Chúng
   chạy *bên trong* `pay_for_service`.
6. **Không tool nào trả private key.** Không claim grant trong `postinstall`.
7. **Mọi hành động của sponsor phải là single-action.** NEP-518 không batch được;
   ví EVM sẽ tách thành nhiều giao dịch chạy lần lượt.
8. **`release_reservation` chỉ sponsor gọi được.** Xem §5 — permissionless là sai
   và lý do không hiển nhiên.

---

## 5. 🪤 Bẫy đã gặp — mỗi cái từng tốn thời gian thật

### 5.1 `key_allowance` là ngân sách gas **trả trước**

Runtime kiểm nó theo **từng giao dịch**, trước khi chạy. Đặt thấp hơn chi phí một
lần gọi thì **grant chết ngay lúc sinh**: mọi payment fail `NotEnoughAllowance`
trong khi budget USDC còn nguyên, và không thông điệp nào của contract giải thích.

Đây là thiết lập **sponsor tự đặt**, nên đặt sai sẽ trông y hệt lỗi của ta.

> Hệ quả ngược đời: client gắn **thừa** gas không phải là phí gas — **nó rút cạn
> key**. Đừng dùng `max_gas()`.

Ghim bởi test `an_allowance_below_one_call_bricks_the_grant`.

### 5.2 `release` permissionless là sai, và lý do không hiển nhiên

Lập luận ban đầu: quá hạn thì chữ ký EIP-3009 chết theo nên không double-spend
được. Đúng với **một** chữ ký, sai khi cộng dồn:

> xin ký → submit → để quá hạn → release → lặp lại. Mỗi lần đều settle, không lần
> nào bị tính, campaign cạn tiền trong khi sổ cái đọc ra 0.

Chỉ ai nhìn được Base mới biết reservation nào thật sự hỏng. Sponsor vừa là bên
đó vừa là bên mất tiền. Mặc định an toàn là **không làm gì**.

### 5.3 `cargo test` không build lại wasm

Nó build binary host. Sandbox nạp `release/grant_manager.wasm` cũ nên bạn sẽ test
nhầm bản trước. **Luôn `npm run near:test`** — nó build trước.

### 5.4 `cargo build` thuần nuốt sạch thông điệp lỗi

Thiếu `--cfg near` thì near-sdk rơi vào nhánh local và mọi `require!` ra tới
caller thành `WebAssembly trap: unreachable`. Contract vẫn chặn đúng, bạn chỉ mất
khả năng biết nó chặn vì gì. `contract-near/.cargo/config.toml` set sẵn; guard 1
của `npm run ci:guards` kiểm.

### 5.5 Đổi `Campaign`/`Grant` phá Borsh với state đã deploy

Không có migration. **Xoá và tạo lại account**, đừng deploy đè. Chấp nhận được
khi còn pre-MVP; sau này thì không.

### 5.6 EIP-712 domain `name` khác nhau giữa hai mạng Base

`"USD Coin"` trên mainnet, `"USDC"` trên Sepolia, cùng `version: "2"`. Hardcode
một cái rồi đổi mạng là chữ ký hỏng **im lặng** — facilitator chỉ trả "invalid
signature". Registry ở `src/base/config.ts`, fixtures phủ cả hai.

### 5.7 near-workspaces 0.21 không nạp được wasm của ta

Báo `CompilationError(PrepareError(Deserialization))`, đọc như file hỏng chứ
không phải opcode không hỗ trợ. Nguyên nhân là bulk-memory từ std dựng sẵn;
`-C target-cpu=mvp` **không** gỡ được. Cách sửa: dùng **0.23**.

### 5.8 Facilitator là phụ thuộc của bên **BÁN**

Resource server mới gọi `/verify` và `/settle`. Agent chỉ ký rồi gửi
`PAYMENT-SIGNATURE`. Trả tiền cho merchant thật **không cần** facilitator nào của
ta — `X402_FACILITATOR` chỉ để chạy `merchant-demo/`.

### 5.9 `merchants: Vec<AccountId>` không chứa được địa chỉ Base

Hex thường là ký tự NEAR hợp lệ nên nó *validate qua*, rồi nổ khi ai đó lỡ đưa
vào `ft_transfer`. Đã tách thành `evm_merchants: Vec<String>`.

---

## 6. Lệnh

```bash
npm run typecheck        # TS
npm run ci:guards        # 2 guard: wasm có --cfg near; không có khoá EVM
npm test                 # 95 test (TS + Rust + sandbox)
npm run near:build       # LUÔN dùng cái này, đừng gọi cargo thẳng
npm run near:test
npm run near:deploy
npm run fixtures         # sinh lại vector EIP-712 bằng viem

# chạy thật trên testnet
CAMPAIGN=<mới> REPO=<mới> npm run near:spike
npm run near:agent -- status                      # tra grant chỉ bằng key của agent
npm run near:agent -- evm-address <campaign>
npm run base:sign -- <campaign> <repo>            # ký thật + ecrecover
npm run merchant                                  # merchant demo của ta (cần MERCHANT_PAYTO)
npm run base:probe -- <url> [--real <campaign> <repo>]
```

**Testnet đang dùng:** sponsor `anyone3-pay.testnet` · dev `agenttest1.testnet` ·
merchant NEAR `anyone-pay.testnet` · token `usdc.fakes.testnet` (mint tự do) ·
merchant Base thật `https://x402.org/protected`, 0.01 USDC, `eip155:84532`.

---

## 7. Sở hữu file

| Vùng | Nội dung |
|---|---|
| `contract-near/src/lib.rs` | Sổ cái. Giữ **dưới 400 dòng code** — đo bằng `grep -vE '^\s*(//\|$)'`, không phải `wc -l` |
| `contract-near/src/evm.rs` | Digest EIP-712 + đường ký Base. Review riêng |
| `contract-near/src/views.rs` | Chỉ đọc, không đổi state |
| `src/core/` | Domain model + quyết định policy. Chain-agnostic, **không** để lọt giả định EVM/NEAR vào đây |
| `src/near/`, `src/base/` | Hai adapter |
| `mcp/`, `web/`, `scripts/`, `merchant-demo/` | Bề mặt sản phẩm |

Phân model: **cái gì quyết định "có được chi tiền hay không" → Opus. Cái gì thực
thi quyết định đó → Sonnet.** 13 task Class A gần như nối tiếp trên `evm.rs` và
`policy.ts` — đừng tách ra nhiều instance, chỉ tạo xung đột merge.

---

## 8. Cần chốt

- [ ] Kích thước một tranche (5 USD mới là con số gợi ý)
- [ ] Cửa sổ reservation 300s có đủ cho verify + settle thật không — đo khi 1.11 chạy được
- [ ] Địa chỉ Base cấp campaign hay cấp grant (MVP chọn campaign)
- [ ] Facilitator Base mainnet: thirdweb (tự phục vụ) hay tự host engine Rust của FastNEAR (nguồn mở, phủ cả NEAR). Chỉ cần khi `merchant-demo` lên mainnet
