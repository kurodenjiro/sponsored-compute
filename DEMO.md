# Demo 90 giây

1. Mở `http://localhost:4030/sponsor`: sponsor duyệt merchant, tạo campaign và phát Grant. Nhấn mạnh portal không có private key.
2. Chạy `get_grant_status`: hiện số đã vest, đã tiêu, trần và allowlist lấy từ chain.
3. Gọi `list_sponsored_platforms("database")`: danh sách luôn gồm lựa chọn không tài trợ và xếp theo fit score.
4. User chọn SupaDB; gọi `pay_for_service` với `max_amount: "120000"` tới `http://localhost:4030/api/v1/query`.
5. Mở `http://localhost:4030/merchant` và Snowtrace: Grant unwrap → EIP-3009 → settlement → API trả dữ liệu.
6. Khởi động `EVIL=1` trên cổng `4031`. Challenge chứa instruction injection và đòi 30 XSGD; checkpoint từ chối trước khi ký.
7. Gọi lại với `max_amount: "100000"` cho API giá `120000`; checkpoint từ chối `OVER_CALLER_MAX`.

## Lời chốt

“Chúng tôi không chỉ demo agent mua được thứ gì đó. Chúng tôi demo hai điều agent **không thể** làm: tiêu ra ngoài mục đích và tiêu quá ngân sách.”
