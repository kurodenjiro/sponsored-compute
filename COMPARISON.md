# So sánh ý tưởng — AgentiX Playground

> Tổng hợp toàn bộ ý tưởng đã bàn ngày 15/08/2026. Phương án đã chốt: **#1 Sponsored Compute** → xem [DECISION.md](DECISION.md).
> Bối cảnh + prior art đầy đủ: [RESEARCH.md](RESEARCH.md) · Chi tiết ý tưởng livestream: [IDEA-livestream-agent.md](IDEA-livestream-agent.md)

---

## 0. Tiêu chí chấm thật (đã verify, không phải suy đoán)

| Giải | Tiêu chí |
|---|---|
| **Avalanche** — Best Use of x402 (S$750) | value proposition · **technical complexity** · **utilization of Avalanche technologies** |
| **StraitsX** — Real-World Impact (S$750) | giải bài toán thương mại đời thực bằng agentic payments |
| **AWS** — Best Architected (S$750) | bảo mật, tin cậy, theo Well-Architected |
| 3 track chính | 1st S$1.000 / 2nd S$500 / 3rd S$250 |

⚠️ **"Novelty" KHÔNG nằm trong tiêu chí nào.** Ngưỡng duy nhất cần vượt: **không được là bản sao sample Phase-3 mà StraitsX phát cho tất cả mọi người**. Vượt rồi thì thôi, đừng tối ưu tiếp.

---

## 1. Bảng tổng

| # | Ý tưởng | Track | Giải nhắm | Prior art | Kịp 24h | Sức hút demo | Trạng thái |
|---|---|---|---|---|---|---|---|
| **1** | **Sponsored Compute** — sponsor ký quỹ XSGD, PBM voucher, agent trả usage qua x402 | Payments Infra | Avalanche + AWS | 🟢 trống | 🟡 căng | 🟢 cao | ✅ **CHỐT** |
| 2 | PBM voucher gửi trong chat (Telegram) — thẻ cho người không có ví | AI-native Commerce | StraitsX Impact | 🟢 trống | 🟢 vừa | 🟢 cao | 🔵 gộp vào #1 làm lớp UI |
| 3 | Agent xem livestream mua thay bạn | AI Commerce Agents | StraitsX Impact | 🟢 trống | 🔴 khó | 🟢 cao | 📄 [file riêng](IDEA-livestream-agent.md) |
| 4 | Định giá theo danh tính agent (ERC-8004) | AI-native Commerce | Avalanche | 🟢 trống | 🟡 vừa | 🟢 cao | ⏸ dự phòng |
| 5 | Cầu PayNow ⇄ x402 cho merchant SG | AI-native Commerce | StraitsX Impact | 🟢 trống | 🟡 vừa | 🟡 tb | ⏸ gộp một phần vào #1 §3 |
| 6 | Mandate / SAFR registry | Payments Infra | Avalanche | 🔴 AP2, IntentBound | 🟡 vừa | 🟡 trừu tượng | ❌ **bỏ** |
| 7 | AdPay402 — credit từ quảng cáo (promptai bản gốc) | Payments Infra | — | 🟢 trống | 🔴 khó | 🟡 tb | ❌ bỏ → tiến hoá thành #1 |
| 8 | Privacy layer cho metadata x402 | Payments Infra | Avalanche | 🟢 trống | 🔴 khó | 🔴 thấp | ❌ bỏ |
| 9 | Shopping agent mua hàng qua x402 | AI Commerce Agents | — | 🔴 **trùng sample BTC** | 🟢 dễ | 🔴 thấp | ❌ **cấm** |

---

## 2. Chi tiết từng ý tưởng

### ✅ #1 — Sponsored Compute *(đã chốt)*
Nền tảng dev-tool ký quỹ XSGD tài trợ hạ tầng cho developer. Agent nhận **PBM voucher** (ERC-7291) ràng buộc mục đích, dùng trả **usage theo mức dùng qua x402**. Hết voucher → dừng dịch vụ.

- 🟢 **x402 chịu lực thật** — agent trả nhiều dịch vụ, nhiều lần, số nhỏ. Đúng định nghĩa x402, không phải gọi 1 endpoint cho có.
- 🟢 **PBM là chuẩn do chính StraitsX viết** (`proj-orchid-straitsx`, ERC-7291). Không cần bịa gì.
- 🟢 **Real-world impact thật**: dev SEA không có thẻ tín dụng quốc tế / vướng forex → không trả nổi SaaS. XSGD + x402 gỡ đúng chỗ.
- 🟢 **Credit = XSGD**, không cần ledger riêng.
- 🔴 Phải dựng cả hai phía sponsor + dev.
- 🔴 Usage định kỳ có thể phình → bắt buộc trần cứng **dừng dịch vụ**.
- 🟡 Giám khảo sẽ hỏi xung đột lợi ích → trả lời trước bằng 3 luật liêm chính danh sách.

### 🔵 #2 — PBM voucher trong chat
*"Gửi mẹ $30 mua đồ ăn, chỉ ở siêu thị, dùng trong tuần này"* → agent bọc XSGD thành PBM voucher, gửi vào Telegram → người nhận mở ra thấy **thẻ Visa ảo**. Không ví, không seed phrase, không cài gì.

- 🟢 **Rủi ro demo thấp nhất** — Telegram Bot API ổn định
- 🟢 Có tiền lệ: StraitsX pilot PBM với **Grab tại SFF 2022**
- 🟢 Người thường hiểu trong 10 giây
- 🔴 Phần "agentic" mỏng → *"sao không dùng cron?"*
- 🔴 Gần **Paystabl** (winner Coinbase) — khác ở chỗ người nhận không có ví

→ **Đã gộp vào #1 làm lớp giao diện.** Kiến trúc giống hệt, chỉ đổi ai là người nhận voucher.

### 📄 #3 — Agent xem livestream
Video commerce ≈ **25% GMV e-commerce SEA**; TikTok Shop SEA $4,4B → **$45,6B**. Phiên live 3–4 tiếng, deal chớp nhoáng — người thật không canh nổi.

- 🟢 Prior art hoàn toàn trống, thị trường thật và lớn
- 🔴 **TikTok Shop không có API mở** — tự động hoá vi phạm ToS, sẽ vỡ giữa demo. Bắt buộc giả lập livestream.
- 🔴 Hiểu video thời gian thực quá nặng cho 24h

→ Chi tiết: [IDEA-livestream-agent.md](IDEA-livestream-agent.md)

### ⏸ #4 — Định giá theo danh tính agent
Số tiền trong 402 challenge **không cố định** — tính từ reputation ERC-8004 + tính không-thể-đảo-ngược của thanh toán. Merchant bán cho agent **rẻ hơn** bán cho người, vì agent trả trước, không chargeback, không tốn CAC.

- 🟢 Đúng nguyên văn mô tả track AI-native Commerce
- 🟢 **Mọi project x402 đã có đều hardcode giá** — chưa ai coi giá là biến số
- 🟢 Demo 20 giây cực sắc: cùng endpoint, hai danh tính, **hai con số 402 khác nhau**
- 🔴 Tự build cả hai đầu; reputation ERC-8004 trong hackathon là rỗng, seed sẽ trông giả

### ⏸ #5 — Cầu PayNow ⇄ x402
Middleware biến merchant PayNow bất kỳ thành x402-native; agent trả XSGD, merchant **nhận SGD vào tài khoản ngân hàng** qua StraitsX Payout API, không cần biết crypto.

- 🟢 **Không hackathon x402 nào chạm tới fiat rail nội địa**
- 🔴 Phụ thuộc Payout API sandbox — chưa thử, nếu không thông phải mock

→ Ý tưởng "cầu sang thế giới không-crypto" đã hấp thụ vào #1 §3 (voucher unwrap thành thẻ Visa).

### ❌ #6 — Mandate / SAFR *(đã bỏ)*
Mandate ký EIP-712 (allowlist merchant + trần + hạn) đăng ký on-chain; facilitator từ chối challenge không khớp; ví agent giữ số dư 0, nạp just-in-time.

**Vì sao bỏ:** khái niệm đã có ở khắp nơi —
- **Google AP2** (09/2025): Intent / Cart / Payment Mandate, W3C VC, 60+ partner gồm Mastercard, PayPal, Coinbase. Đã có sẵn **A2A x402 extension**.
- **IntentBound**: Intent Certificate + Gate, off-chain, patent pending
- **ERC-7710**: delegation primitive
- **MAS SAFR** (07/2026): declare → assess at runtime → retain records

Và **PBM (#1) làm tốt hơn**: policy nằm *trong chính đồng tiền* (bearer instrument) thay vì trong registry bên cạnh — lại là chuẩn do chính StraitsX viết.

> Phần **giới hạn thiệt hại vật lý** của ý tưởng này vẫn được giữ trong #1: XSGD không có ERC-1271 → EOA session giữ số dư 0 tới đúng khoảnh khắc chi.

### ❌ #7 — AdPay402 *(bỏ, đã tiến hoá)*
Agent nhàn rỗi → phục vụ ad có kiểm chứng → nhận XSGD → tiêu tiếp qua x402.

**Vì sao bỏ:**
- 🔴 **Nghịch lý chú ý**: bán "thời gian chết" nhưng giá trị quảng cáo cần sự chú ý — mà lúc agent chạy thì dev đã đi chỗ khác
- 🔴 **Ad fraud không giải được**: SSV chỉ chứng minh trình phát báo cáo xong, không chứng minh có người nhìn
- 🔴 Kinh tế tự mâu thuẫn 12–36x (payout $0,05–0,15 vs calculator ngụ ý $1,80/view)

→ **Tiến hoá qua 3 bước thành #1**: ad → sponsor trả cho tích hợp thật → chợ tool → credit trả usage. Mỗi bước gỡ đúng một lỗi. Bản cuối có ground truth kiểm chứng được, không còn fraud kiểu ad.

### ❌ #8 — Privacy layer cho metadata x402
Paper `arXiv 2604.11430` chỉ ra `resource_url`, `description`, `reason` đi **plaintext** tới payment server + facilitator trước khi settle → lộ hành vi mua sắm, liên kết được transaction graph.

- 🟢 Chưa ai làm
- 🔴 Privacy **rất khó demo trên sân khấu** — không có gì để chỉ tay vào

### ❌ #9 — Shopping agent *(cấm)*
4 bước Funding → Discovery → Issuance → Execution **chính là sample Phase-3 của StraitsX**. Build lại = nộp lại code của ban tổ chức. Ngoài ra hàng chục project ở SF/Solana/Cronos/Coinbase/Berlin đã làm.

---

## 3. Prior art — cái gì đã có ai làm (đã rà)

| Ý tưởng | Ai đã làm | Nguồn |
|---|---|---|
| Shopping agent | sample StraitsX + hàng chục project | mọi hackathon x402 |
| Credit + reputation layer | **Legasi** (SF 2nd), **ParallaxPay**, **ACN** | SF, Solana, ETHGlobal |
| Risk engine cho tx của agent | **Cronos Shield** (2nd) | Cronos |
| DCA tự động qua x402 | **DCA402** | Cronos |
| Escrow có oracle | **x402Resolve**, **Mand(ate)** | Solana, HackMoney |
| Payroll stablecoin | **Paystabl** | Coinbase |
| Bán compute / pay-per-inference | **Galaksio**, **Learn Earn**, **Agentx402** | Solana |
| Cross-chain agent payment | **SnowRail** | Cronos |
| Mandate/intent authorization | **Google AP2**, **IntentBound** | sản phẩm thật |
| **Tiền chảy NGƯỢC về agent** | **chưa ai** | — |
| **Fiat rail nội địa (PayNow/SGD)** | **chưa ai** | — |
| **PBM × x402** | **chưa ai** | — |
| **Giá là biến số theo danh tính** | **chưa ai** | — |
| **Livestream commerce agent** | **chưa ai** | — |

---

## 4. Nếu phải đổi phương án

Kịch bản → chọn gì:

- **0xGasless không hỗ trợ Fuji 43113** → không đổi ý tưởng, đổi sang self-custody mode + facilitator x402-rs tự host
- **Không kịp dựng phía sponsor** → rơi về **#2** (voucher trong chat), giữ nguyên PBM + x402 + thẻ, chỉ đổi ai phát voucher
- **PBM wrapper quá khó, contract không xong** → bỏ wrapper ERC-1155, giữ allowlist + trần enforce ở facilitator. Vẫn demo đủ, nhưng **phải nói rõ đã đơn giản hoá**
- **Còn dư thời gian** → thêm **#4** (giá theo danh tính) làm demo phụ 20 giây, ERC-8004 đã có sẵn từ 0xGasless

---

## 5. Hai blocker quyết định — chưa gỡ

1. 🔴 **Chưa có XSGD testnet** — phải submit ví cho BTC. Không tự giải được.
2. 🔴 **Chưa biết 0xGasless có chạy Fuji 43113 không** — docs chỉ ghi Avalanche **43114 mainnet**. Check TRƯỚC khi viết code, vì nó quyết định phần lớn kiến trúc.

Việc **không** phụ thuộc blocker nào, làm được ngay: **script ký EIP-3009 end-to-end với `issue_card`** — chung cho cả 9 phương án.
