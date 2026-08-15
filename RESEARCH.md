# AgentiX Playground — Research & Idea Brief

> Nguồn: [Notion Dev Hub](https://app.notion.com/p/convergencesummit/AgentiX-Playground-Dev-Hub-3b354aa8ea60806e80acd3c1a43b019f) + slide tracks/prizes + research web (15/08/2026)

---

## 1. Bối cảnh & timeline

- Hackathon: **14 – 16/08/2026** (hôm nay là **ngày 2/3**) tại SMU, Singapore.
- Tổ chức: **StraitsX** (host) + **Avalanche** (title partner) + AWS, Crossmint, Convergence Summit, SMU FinTech.
- Prize pool: ~**S$7,500** (3 track × 3 giải) + **3 sponsor award × S$750**.
- Track + team phải chốt ngay; **1 project chỉ được đăng ký 1 track**.
- Winner được showcase tại booth StraitsX ở **Singapore FinTech Festival**.

### Bài toán khung mà BTC đưa ra (4 milestone của vòng đời thanh toán)

| # | Milestone | Mô tả |
|---|-----------|-------|
| 1 | **Funding** | Nạp XSGD (SGD stablecoin) vào ví **non-custodial** |
| 2 | **Discovery** | AI agent nhận lệnh mua → quét site e-commerce → tìm đúng item |
| 3 | **Issuance** | Phát hành **thẻ ảo dùng-một-lần** động cho agent |
| 4 | **Execution** | Agent checkout bằng thẻ ảo đó |

> ⚠️ Đây chính là **reference stack có sẵn của StraitsX** (Phase-3: card gateway + demo store + conformance suite + shopping agent mẫu). Nếu chỉ build lại đúng 4 bước này → **trùng với sample code của BTC**, gần như chắc chắn không thắng. Phải build **layer nằm trên/ngoài** 4 bước đó.

---

## 2. Yêu cầu kỹ thuật (bắt buộc)

### 2.1 Hard requirement
- **Bắt buộc dùng $XSGD trên Avalanche C-Chain Mainnet** (theo slide "Requirements").
  - XSGD mainnet: `0xb2F8...096E`, chain `eip155:43114`
  - XSGD Fuji (sandbox): `0xd769...c2A5`, chain `eip155:43113`
  - ⚠️ **Xung đột cần xử lý**: Dev Hub chỉ cấp faucet **Fuji** + MCP **sandbox**; slide lại yêu cầu **Mainnet**. → Chiến lược an toàn: dev/demo trên Fuji, nhưng **phải có ít nhất 1 giao dịch XSGD thật trên C-Chain Mainnet** (dù chỉ vài cent) + link Snowtrace trong slide để đủ điều kiện. Hỏi BTC confirm sớm; mainnet còn cần **whitelisting**.

### 2.2 Stack BTC cung cấp

| Thành phần | Endpoint / Docs |
|---|---|
| Avalanche docs | https://docs.avax.network/ |
| RPC Mainnet C-Chain | `https://api.avax.network/ext/bc/C/rpc` |
| RPC Fuji C-Chain | `https://api.avax-test.network/ext/bc/C/rpc` |
| Fuji AVAX faucet | https://faucet.avax.network/ |
| StraitsX API docs | https://docs.straitsx.com/docs |
| **Card issuance MCP (sandbox)** | `https://card.straitsx.ai/sandbox/sse` |
| **Card issuance MCP (prod)** | `https://card.straitsx.ai/production/sse` |
| Crossmint docs | https://docs.crossmint.com/ |

**XSGD không có public testnet faucet** → phải submit địa chỉ ví cho BTC để được cấp XSGD testnet.

### 2.3 StraitsX Card MCP — tool có sẵn
> ⚠️ **ĐÃ SỬA sau khi probe live sandbox** — xem [DECISION.md](DECISION.md) §0.2. Tên tool thật là `get_card_sandbox` / `view_card_sandbox`. Danh sách bên dưới (`get_virtual_card`, `get_wallet_status`, `approve_payment`) lấy từ trang glama.ai là **SAI** — đó là repo demo bên thứ ba, không phải server của BTC.

**Luồng x402 của card gateway** (đây là điểm kỹ thuật cốt lõi cần nắm):
1. Gateway `POST` xin thẻ (chưa trả tiền)
2. Card API trả **HTTP 402** + challenge trong header `PAYMENT-REQUIRED`
3. Gateway decode challenge → lấy asset / amount / network / domain
4. Gateway ký **EIP-3009 `transferWithAuthorization`** cho XSGD (gasless, chỉ dùng giá trị lấy từ challenge — **không tự tính amount client-side**)
5. Retry kèm header `PAYMENT-SIGNATURE`
6. Settle on-chain → nhận thẻ ảo

Giới hạn thẻ: **5–30 SGD/thẻ** (enforce server-side). Đơn vị "12" = 12.00 SGD.

### 2.4 StraitsX REST API (ngoài card)
Customer Profiles (KYC), Payment API (**PayNow / bank transfer + QR**), Payout API (bulk disbursement), Swap API, Blockchain API (on-chain deposit/withdraw), Transaction Limit API.
→ **PayNow QR là vũ khí "real-world impact" mạnh nhất** mà các hackathon x402 khác trên thế giới không có.

### 2.5 Crossmint
Headless Checkout REST API (agent mua hàng Amazon/Shopify/guest checkout, ~1 tỷ SKU, không dính CAPTCHA/3DS, Crossmint là Merchant of Record) + **Agentic Cards API** (Visa Intelligent Commerce + Basis Theory, launch 02/06/2026).

---

## 3. Ba track — chọn cái nào?

| Track | Bản chất | Prize | Mức độ đông/cạnh tranh |
|---|---|---|---|
| **AI Commerce Agents** | Agent discover / compare / mua hàng | S$1,000 / 500 / 250 | 🔴 Cao nhất — ai cũng làm, và trùng sample của BTC |
| **Agentic Payments Infrastructure** | Ví, payment rails, **policy**, protocol để AI tiêu tiền **an toàn** | S$1,000 / 500 / 250 | 🟡 Trung bình — dễ ăn thêm AWS award |
| **AI-native Commerce** | Merchant experience / API / protocol để agent là **khách hàng hạng nhất** | $1,000 / 500 / 250 | 🟢 Ít người chọn nhất (khó hình dung) |

**Sponsor awards (S$750 mỗi giải, cộng dồn được với track prize):**
- **StraitsX – Real-World Impact**: giải bài toán thương mại đời thực → cần yếu tố SG thật (PayNow, hawker, SME, GST).
- **Avalanche – Best Use of x402**: phải dùng x402 **sâu**, không chỉ gọi 1 endpoint.
- **AWS – Best Architected**: bảo mật/tin cậy theo Well-Architected → cần sơ đồ kiến trúc, threat model, KMS/Secrets Manager, retry/idempotency, observability.

---

## 4. Research: các dự án x402 đã thắng ở hackathon khác (kiểm tra trùng lặp)

### 4.1 SF Agentic Commerce x402 (324 dev, 86 project)
- 🥇 **World of Geneva** — MMORPG mà AI agent tự chơi, human xem
- 🥈 **Legasi** — **credit + reputation layer cho AI agent**: hạn mức tín dụng, x402 payment, yield trên tiền nhàn rỗi, reputation on-chain

### 4.2 Solana x402 Hackathon
Sentinel Agent (agent trả tiền mua AI analysis — AI-to-AI economy) · **Galaksio** (USDC mua compute/storage) · **Learn Earn** (autonomous tutor, chấm bài bằng model 120B qua x402) · **ParallaxPay** (marketplace agent + swarm + reputation on-chain) · Agentx402 · **x402 Triton Gateway** (micropayment query dữ liệu lịch sử) · scanna-x402 · InsightAI · Marketputer · Polycaster · **x402Resolve** (escrow xác thực bằng oracle)

### 4.3 Cronos x402 PayTech (191 team)
🥇 **SoulForge Market** (agent tự giao dịch thị trường tài chính) · 🥈 **Cronos Shield** (**risk-management engine cho giao dịch của agent**) · 🥉 **CroIgnite** (auto-deploy/sponsor agentic flow) · **DCA402** (DCA tự động qua x402) · **SnowRail** (cross-chain agent payment) · Coset

### 4.4 Coinbase "Agents in Action"
**Paystabl** (payroll agent, lương stablecoin định kỳ) · **FastAPI x402** (package Python monetize API) · Monetization Templates · bot spin-up AI job trên Akash trả theo usage

### 4.5 Algorand Berlin x402
110+ builder, 36h, $20k USDC.

### ⚠️ Ma trận trùng lặp — cái gì KHÔNG nên làm

| Ý tưởng | Đã có ai làm | Rủi ro |
|---|---|---|
| Shopping agent mua hàng qua x402 | Sample của chính StraitsX + hàng chục project | 🔴 Rất cao |
| Credit/reputation layer cho agent | Legasi, ParallaxPay, ACN | 🔴 Cao |
| Risk engine / guardrail cho agent tx | Cronos Shield | 🟡 Trung bình |
| DCA tự động qua x402 | DCA402 | 🟡 Trung bình |
| Escrow milestone có oracle | x402Resolve, Mand(ate) | 🟡 Trung bình |
| Pay-per-inference / bán compute | Galaksio, Parallax, Learn Earn | 🟡 Trung bình |
| Payroll stablecoin | Paystabl | 🟡 Trung bình |
| **Tiền chảy NGƯỢC về agent (agent kiếm tiền)** | **Chưa thấy ai** | 🟢 Trống |
| **x402 gắn với fiat rail nội địa (PayNow/QR)** | **Chưa thấy ai** | 🟢 Trống |
| **Thẻ ảo dùng-một-lần + mandate on-chain** | Gần nhất là Crossmint/Visa (sản phẩm, không phải hackathon) | 🟢 Khá trống |

**Kết luận:** khoảng trống thật sự nằm ở **(a) fiat rail Singapore (PayNow/XSGD/GST) mà không hackathon nước ngoài nào chạm tới**, và **(b) chiều tiền đi ngược — agent kiếm tiền chứ không chỉ tiêu tiền**.

---

## 5. Dự án thắng giải KHÔNG liên quan x402 — có thể tích hợp

| Dự án / công nghệ | Nguồn | Tích hợp thế nào vào bài này |
|---|---|---|
| **ACN (Agent Collaboration Network)** — ENS subname cho agent (`summariser.acn.eth`) + reputation lưu trên PublicResolver + escrow settle tức thì | ETHGlobal | Cấp **danh tính cho agent** trên Avalanche C-Chain: mỗi agent 1 subname + on-chain policy record. Merchant tra được agent nào đáng tin trước khi bán. |
| **Mand(ate)** — thắng track Treasury & Agentic Commerce HackMoney 2026: agent thương lượng điều khoản, theo dõi milestone, tự release tiền | ETHGlobal | Layer **invoice/mandate**: biến "lệnh mua" của user thành mandate ký được, có điều kiện, revoke được. |
| **Fireblocks x402-facilitator** — hỗ trợ EIP-3009 **+ Permit2 + ERC-7710** | GitHub | **ERC-7710 delegation** là điểm kỹ thuật ăn tiền: thay vì đưa key cho agent, **ủy quyền có giới hạn & thu hồi được**. Rất ít team hackathon biết dùng. |
| **Crossmint Agentic Cards (Visa Intelligent Commerce + Basis Theory)** | Crossmint, 06/2026 | Fallback rail khi merchant không nhận x402 → agent vẫn mua được ở mọi nơi nhận Visa. |
| **Cronos Shield** (risk engine) | Cronos | Mượn ý tưởng scoring rủi ro, nhưng đặt vào ngữ cảnh **MAS/consumer-protection SG** để khác biệt. |
| **PaySats** — pocket theo mục tiêu, smart wallet social login, self-custody, DCA on-chain, thẻ Visa spend trực tiếp | ý tưởng của bạn | Xem §6.1 |
| **promptai.credit** — ad-funded compute credit, server-side signed verification chống gian lận, CPV $0.05–$1.00 | ý tưởng của bạn | Xem §6.2 |

---

## 6. Đánh giá 2 ý tưởng bạn đưa ra

### 6.1 PaySats → chuyển thể sang XSGD/Avalanche

**Gốc:** BTC DCA tự động từ Rp 25.000, vay IDR thế chấp BTC, self-custody, smart wallet đăng nhập bằng Google/email, nhiều "pocket" theo mục tiêu, sắp có thẻ Visa tiêu BTC trực tiếp.

**Cái map được sang hackathon (rất tốt):**
- ✅ **Pocket theo mục tiêu** → **budget pocket cho từng agent / từng mục đích** (ăn uống, subscription, mua sắm). Đúng tinh thần "policies" của track Infrastructure.
- ✅ **Self-custody + smart wallet social login** → đúng yêu cầu "non-custodial wallet" ở milestone Funding, lại onboard nhanh cho demo.
- ✅ **Smart contract tự execute** → chuyển thành **mandate contract**: agent chỉ rút được trong hạn mức/thời gian/merchant cho phép.
- ✅ **Thẻ Visa spend** → chính là `get_virtual_card` của StraitsX MCP.

**Cái KHÔNG map được (bỏ đi):**
- ❌ Vay thế chấp / lending — không có trong track nào, tốn thời gian, và không dùng XSGD một cách thuyết phục.
- ❌ DCA đầu tư — đã có DCA402 làm rồi, và "đầu tư" không phải chủ đề của hackathon này.

**Verdict:** Lấy **kiến trúc ví + pocket + card**, bỏ phần đầu tư/lending. → nền cho ý tưởng #1 ở §7.

### 6.2 promptai.credit → chuyển thể sang x402

**Gốc:** Dev xem quảng cáo dev-tool trong lúc agent đang chạy → nhận credit chạy model. Server ký xác nhận đã xem (chống gian lận). Advertiser trả CPV $0.05–$1.00, chỉ tính khi view hoàn tất.

**Điểm mạnh:** đây là **hướng tiền đi ngược** — hầu như toàn bộ hệ x402 hiện nay chỉ làm "agent trả tiền". Cơ chế "attestation có chữ ký → mở khoá payout" ghép **cực khớp** với x402: quảng cáo xem xong → facilitator settle XSGD về ví agent → agent dùng chính XSGD đó trả cho API/thẻ.

**Điểm yếu cho hackathon này:**
- ⚠️ "Real-World Impact" của StraitsX sẽ khó chấm hơn (ad-tech, không phải commerce).
- ⚠️ Cần cả 2 phía (advertiser + dev) mới demo thuyết phục → tốn thời gian trong ~24h còn lại.
- ⚠️ Ad fraud là chủ đề dễ bị giám khảo vặn.

**Verdict:** Ý tưởng **khác biệt nhất**, nhưng rủi ro thời gian cao. Chỉ nên chọn nếu team ≥3 người và mạnh về frontend demo.

---

## 7. Ba đề xuất cụ thể (xếp theo khuyến nghị)

### 🥇 #1 — "XSGD Agent Wallet with Programmable Mandates"
**Track: Agentic Payments Infrastructure** · nhắm thêm **AWS Best Architected** + **Avalanche Best Use of x402**

Ví XSGD non-custodial trên Avalanche C-Chain, chia thành **pocket** (ý tưởng PaySats), mỗi pocket gắn một **mandate on-chain** do người dùng ký: hạn mức/giao dịch, hạn mức/ngày, danh sách merchant, thời hạn, và **revoke được tức thì**. Agent muốn tiêu → phải xin thẻ ảo qua x402; mandate contract quyết định ký hay không ký EIP-3009. Vượt ngưỡng → đẩy sang `approve_payment` cho người duyệt. Mọi việc ghi log thành **audit trail on-chain**.

- **Khác biệt vs sample của BTC:** BTC ký mọi challenge; bạn thêm **tầng quyết định có ký hay không**.
- **Khác biệt vs Cronos Shield:** họ scoring rủi ro sau khi xảy ra; bạn **chặn trước bằng quyền hạn on-chain, thu hồi được**.
- **Điểm cộng kỹ thuật:** dùng **ERC-7710 delegation** thay vì đưa private key cho agent.
- **Demo 90 giây:** đặt mandate S$30/ngày → agent mua 2 món OK → món thứ 3 vượt hạn mức bị **chặn on-chain** → user bấm revoke → agent lập tức mất quyền tiêu.
- **Điểm mạnh nhất:** cảnh "bị chặn" là thứ ăn điểm nhất trên sân khấu — mọi team khác chỉ demo cảnh mua thành công.

### 🥈 #2 — "PayNow ⇄ x402 Bridge: cho merchant SG bán hàng cho agent"
**Track: AI-native Commerce** · nhắm **StraitsX Real-World Impact**

Merchant Singapore hiện có **PayNow QR**, không có gì cho AI agent. Build một **cổng biến bất kỳ merchant PayNow thành x402-native merchant**: một dòng middleware/SDK → API/checkout của họ tự trả HTTP 402 với challenge XSGD; agent trả bằng XSGD trên C-Chain; merchant **nhận SGD vào tài khoản ngân hàng** qua StraitsX Payout API mà không cần biết crypto là gì. Kèm `agents.txt` / discovery manifest để agent tự tìm ra sản phẩm & giá.

- **Trống hoàn toàn:** không hackathon x402 nào ở SF/Solana/Cronos/Berlin chạm tới fiat rail nội địa.
- **Real-world impact rõ ràng:** hawker/SME Singapore bán được cho agent mà không đổi hệ thống.
- **Rủi ro:** phụ thuộc Payout API sandbox — cần thử ngay, nếu không thông thì mock và nói rõ.

### 🥉 #3 — "AdPay402: Reverse x402" (từ promptai.credit)
**Track: AI-native Commerce** hoặc **Infrastructure**

Agent nhàn rỗi → phục vụ một ad có kiểm chứng → facilitator settle **XSGD về ví agent** → agent dùng chính số dư đó trả cho API/thẻ ảo. Tức là **x402 hai chiều**: agent vừa là người mua vừa là nguồn thu.

- **Novelty cao nhất** trong toàn bộ landscape đã research.
- Cần: proof-of-view có chữ ký server, chống replay (nonce), rate-limit, dashboard advertiser.
- **Chỉ chọn nếu còn ≥20h và team ≥3 người.**

---

## 8. Khuyến nghị

Chọn **#1**, và **mượn #2 làm một feature nhỏ** (một merchant PayNow trong demo) để với tay sang giải Real-World Impact — vì một project chỉ được đăng ký **một track**, nhưng sponsor award chấm độc lập.

**Checklist ngày 2 (hôm nay):**
1. Submit địa chỉ ví cho BTC để nhận **XSGD testnet** — làm ngay, đây là blocker duy nhất không tự giải được.
2. Hỏi BTC: mainnet có bắt buộc thật không, whitelisting mất bao lâu.
3. Kết nối **MCP sandbox** `https://card.straitsx.ai/sandbox/sse`, chạy thử `get_wallet_status` → `get_virtual_card` để nắm đúng format challenge 402.
4. Viết mandate contract (Solidity, ~150 dòng) + deploy Fuji.
5. Thực hiện **1 giao dịch XSGD thật trên C-Chain Mainnet**, lưu link Snowtrace.
6. Vẽ sơ đồ kiến trúc AWS Well-Architected (KMS cho key, idempotency, retry, audit log) — 1 slide này là đủ để tranh giải AWS.
