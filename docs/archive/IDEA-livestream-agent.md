# Ý tưởng: Agent xem livestream và mua thay bạn

> Trạng thái: **ghi lại để cân nhắc** — chưa chốt. Xem [DECISION.md](DECISION.md) cho hướng đang nghiêng về (PBM × x402).
> Ghi ngày 15/08/2026.

---

## 1. Ý tưởng một câu

Agent xem phiên livestream bán hàng thay người dùng, bắt được deal khớp tiêu chí đã đặt trước, và **tự mua trong vài giây** bằng thẻ Visa ảo phát ra qua x402 — chi tiêu bị ràng buộc bởi một voucher PBM (ngân sách + ngành hàng + người bán + thời hạn).

## 2. Vấn đề có thật

Phiên live ở SEA kéo dài **3–4 tiếng**, deal chớp nhoáng, "100 người đầu tiên", hết hàng trong vài giây.

- Người thật không ngồi canh nổi 4 tiếng để chờ đúng 30 giây quan trọng.
- Phía **người bán đã có bot** từ lâu (auto-comment, auto-pin, auto-restock). Phía **người mua thì chưa có gì**.
- Cản trở lớn nhất khiến người ta không dám để AI mua hộ: **"nhỡ nó mua bậy thì sao?"** — đây chính là chỗ PBM giải quyết.

## 3. Số liệu thị trường (đã tra 15/08/2026)

| Chỉ số | Giá trị |
|---|---|
| E-commerce SEA | **$215–230B** (cuối 2026), lên $350–370B (2030) |
| Video commerce | **≈25% toàn bộ GMV e-commerce SEA** |
| TikTok Shop SEA GMV | **$4.4B → $45.6B** (10x), gấp đôi YoY |
| Đặc thù SEA | **live-commerce-first** — Thái Lan, Việt Nam bán live nhiều giờ là chuẩn mực |
| Singapore | người bán video commerce **+125% YoY → 80.000** |
| Người bán TikTok Shop toàn cầu | 15M+ |
| Creator >$1M GMV | 1.785 (gấp 3 trong 2025) |

Ghi chú: Singapore nhỏ về GMV nhưng là **cửa ngõ thương hiệu cao cấp** — hợp với góc kể chuyện "làm ở SG, mở rộng ra SEA".

## 4. Vì sao hợp hackathon này

- **Track**: AI Commerce Agents (agent discover / compare / purchase) — khớp thẳng mô tả.
- **Prior art**: đã rà SF · Solana · Cronos · Coinbase · Algorand Berlin — **không hackathon x402 nào làm livestream commerce**. Đây là góc trống thật.
- **Thẻ ảo dùng-một-lần** là tài sản độc nhất của hackathon này, và livestream là kịch bản mà "thẻ dùng một lần, phát đúng lúc, đúng số tiền" có lý do tồn tại rõ ràng nhất.
- **PBM (ERC-7291)** — chuẩn do chính StraitsX + MAS Project Orchid viết — vào đúng chỗ: *"chỉ được tiêu $30 cho đồ chăm sóc da, ở người bán này, trong tối nay."*

## 5. Kiến trúc

```
User đặt tiêu chí ──▶ PBM voucher (ERC-7291, bọc XSGD, Avalanche)
                          │  ngân sách · ngành hàng · seller allowlist · hạn dùng
                          ▼
   Livestream ──▶ Agent theo dõi (offer/giá/tồn kho dạng sự kiện)
                          │
                    khớp tiêu chí?
                          │ có
                          ▼
              PBM unwrap ──▶ XSGD ──▶ x402 402-challenge
                          │
                    ký EIP-3009 (EOA)
                          ▼
              Thẻ Visa ảo dùng-một-lần ──▶ checkout
```

### Thông số kỹ thuật đã verify (probe live 15/08/2026)

- Endpoint: `POST https://card.straitsx.ai/sandbox/cardapi/issue_card`
- Body: `{"amount_sgd": <5..30>, "cardholder_name": "<2-26 ký tự>"}`
- Trả **HTTP 402** + header `Payment-Required` (base64) → decode ra:
  `scheme:"exact"`, `network:"eip155:43113"`, `asset:0xd769410dc8772695a7f55a304d2125320a65c2a5`, `payTo:0x99a2B2962a6AC463FBe04664027Fdb3F68bd4Cc8`, `maxTimeoutSeconds:300`, `extra:{assetTransferMethod:"eip3009", name:"XSGD", version:"2"}`
- Ký EIP-3009 `transferWithAuthorization`, domain `{name:"XSGD", version:"2", chainId:43113, verifyingContract:<asset>}`
- base64 JSON → header `PAYMENT-SIGNATURE` → retry → nhận `card_opaque_id`, `card_html`, `settlement_tx`
- XSGD Fuji: **6 decimals** (`"5000000"` = 5.00 SGD)
- ⚠️ XSGD **không có ERC-1271** → EIP-3009 chỉ nhận chữ ký ECDSA từ **EOA**; smart account ERC-4337 không tự ký được. PBM unwrap phải cấp XSGD cho một EOA session ngay trước khi ký.

## 6. Kịch bản demo

1. User: *"Tối nay xem live của SkinLab, thấy serum dưới $25 thì mua cho tôi 1 chai."* → tạo PBM voucher: `$25 · skincare · seller=SkinLab · hết hạn 23:59`.
2. Livestream chạy. Agent theo dõi, bỏ qua vài offer không khớp (**quan trọng — phải cho thấy nó biết từ chối**).
3. Đến offer khớp: agent bắt trong **vài giây** → PBM unwrap → 402 → ký → **thẻ Visa hiện ra** → checkout.
4. Offer thứ hai: giá $40, vượt voucher → **bị chặn**, agent không mua được dù có tiền trong ví.
5. Hiện `settlement_tx` trên Snowtrace.

Điểm ăn tiền: bước **2 và 4** — cho thấy agent *không mua*. Mọi team khác chỉ demo cảnh mua thành công.

## 7. Rủi ro — đọc kỹ trước khi chọn

🔴 **TikTok Shop không có API mở cho agent mua hàng.** Tự động hoá gần như chắc chắn vi phạm ToS và sẽ vỡ giữa demo. Crossmint phủ Amazon/Shopify/guest checkout — **không phủ TikTok**.
→ Bắt buộc demo trên **livestream mô phỏng tự dựng**. Và **phải nói thẳng điều đó với giám khảo**, đừng để họ tự phát hiện.

🔴 **Hiểu video/audio thời gian thực quá nặng cho 24h.** Phải rút xuống thành stream phát sự kiện dạng text/caption (JSON offer feed), coi phần thị giác là ngoài phạm vi và tuyên bố rõ.

🟡 **Trần thẻ 5–30 SGD** — mọi kịch bản phải nằm trong khoảng này. Không demo được món hàng $200.

🟡 **`maxTimeoutSeconds: 300`** — chu trình unwrap → ký → settle phải xong trong 5 phút. Trên Avalanche (finality ~1s, phí ~$0.001) thì thừa sức, nhưng cần đo thật.

🟡 **Câu hỏi giám khảo sẽ hỏi**: *"phần agentic thật sự nằm ở đâu, hay chỉ là if-price-under-X?"* Phải có phần quyết định thật: so sánh nhiều offer, đánh giá độ tin cậy người bán, ưu tiên khi ngân sách có hạn.

## 8. Nếu chọn thì cắt scope thế nào

**Phải có (MVP):**
- Feed sự kiện livestream mô phỏng (JSON offers)
- PBM wrapper tối giản: wrap / unwrap có điều kiện / allowlist — **khai báo rõ là "PBM-compatible subset", không phải full ERC-7291**
- Script ký EIP-3009 end-to-end với `issue_card`
- UI: stream + quyết định của agent + thẻ hiện ra

**Bỏ nếu thiếu giờ:** hiểu video thật, nhiều người bán, so sánh giá xuyên sàn, phần RWA sinh lợi.

## 9. So với các phương án khác

| | Livestream agent | PBM trong chat (S2) | Mandate/SAFR |
|---|---|---|---|
| Track | AI Commerce Agents | AI-native Commerce / Infra | Agentic Payments Infra |
| Độ trống prior art | 🟢 chưa ai làm | 🟢 chưa ai nối PBM×x402 | 🟡 AP2/IntentBound đã có |
| Rủi ro demo | 🔴 cao (phải giả lập) | 🟢 thấp (Telegram Bot API) | 🟡 trung bình |
| Sức hút sân khấu | 🟢 cao | 🟢 cao | 🟡 trừu tượng |
| Hợp 24h còn lại | 🔴 căng | 🟢 vừa | 🟡 vừa |

**Kết luận ghi lại:** ý tưởng mạnh, góc thị trường thật và trống — nhưng **rủi ro demo cao nhất** trong các phương án, vì phần "livestream" bắt buộc phải giả lập. Chỉ chọn nếu chấp nhận điều đó và nói thật với giám khảo.
