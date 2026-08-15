import Link from 'next/link';

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth: 880, margin: '0 auto', padding: '64px 24px 96px' },
  kicker: { color: '#34d399', fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700 },
  h1: { fontSize: 44, lineHeight: 1.15, margin: '12px 0 20px', letterSpacing: -1 },
  lead: { fontSize: 18, lineHeight: 1.65, color: '#9ca3af', maxWidth: 660 },
  cta: { display: 'inline-block', marginTop: 28, background: '#34d399', color: '#052e21', padding: '13px 24px', borderRadius: 10, fontWeight: 700, textDecoration: 'none' },
  section: { marginTop: 64 },
  h2: { fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 700, marginBottom: 20 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 },
  card: { border: '1px solid #1f2937', borderRadius: 12, padding: 20, background: '#111827' },
  cardH: { fontSize: 15, margin: '0 0 8px' },
  cardP: { fontSize: 14, lineHeight: 1.6, color: '#9ca3af', margin: 0 },
  code: { display: 'block', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 16, fontSize: 13, overflowX: 'auto', color: '#e2e8f0', lineHeight: 1.7 },
  note: { fontSize: 13, color: '#6b7280', marginTop: 12, lineHeight: 1.6 },
};

export default function Home() {
  return (
    <main style={S.wrap}>
      <p style={S.kicker}>XSGD · Avalanche · x402</p>
      <h1 style={S.h1}>
        Tài trợ hạ tầng cho developer —<br />
        tiền ràng buộc mục đích, agent tự tiêu.
      </h1>
      <p style={S.lead}>
        Nền tảng dev-tool ký quỹ XSGD. Developer nhận một <b>Grant</b> — khoản tiền đã bị ràng buộc
        chỉ tiêu được ở đúng nền tảng đó. Agent lập trình của họ (Claude Code, Codex) trả tiền
        theo mức dùng qua x402, ngay trong terminal. Không thẻ, không tài khoản, không forex.
      </p>
      <Link href="/sponsor" style={S.cta}>Trở thành sponsor →</Link>

      <section style={S.section}>
        <h2 style={S.h2}>Khác gì credit thường</h2>
        <div style={S.grid}>
          <div style={S.card}>
            <h3 style={S.cardH}>Tiền di chuyển thật</h3>
            <p style={S.cardP}>
              Credit thường là lời hứa trong database của một nhà cung cấp. Đây là XSGD đã ký quỹ
              on-chain — nền tảng nhận được tài trợ mà không cần hợp đồng với sponsor.
            </p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>Máy tự đổi được</h3>
            <p style={S.cardP}>
              Đổi credit thường cần đăng nhập, form, mã khuyến mãi — đều là hình dạng cho con người.
              x402 chỉ cần một chữ ký, nên agent tự làm được.
            </p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>Hết là dừng</h3>
            <p style={S.cardP}>
              Credit thường cạn thì họ bắt đầu trừ thẻ. Ở đây không có thẻ nào để trừ —
              thanh toán đơn giản là thất bại. Dừng cứng là mặc định.
            </p>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Sponsor làm gì</h2>
        <div style={S.grid}>
          <div style={S.card}>
            <h3 style={S.cardH}>1 · Ký quỹ</h3>
            <p style={S.cardP}>Nạp XSGD vào campaign, đặt hạn mức mỗi giao dịch, mỗi ngày, và số tranche.</p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>2 · Nhận lệnh cài</h3>
            <p style={S.cardP}>Portal trả về một dòng lệnh. Dán vào repo mẫu của bạn là xong.</p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>3 · Trả theo kết quả</h3>
            <p style={S.cardP}>
              Grant nhả dần theo tranche, điều kiện xác minh bằng chính dấu vết thanh toán on-chain.
              Không dùng thật thì không mở khoá tiếp.
            </p>
          </div>
        </div>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Developer chỉ cần một dòng</h2>
        <code style={S.code}>
          npx -y @sponsored-compute/cli init --campaign 0x…
        </code>
        <p style={S.note}>
          Lệnh này ghi <code>sponsored.json</code> (con trỏ tới campaign) và <code>.mcp.json</code>{' '}
          (khai báo MCP server). Mở Claude Code trong thư mục đó và hỏi
          “dự án này có tài trợ không?”.
        </p>
      </section>

      <section style={S.section}>
        <h2 style={S.h2}>Ba luật chúng tôi không đánh đổi</h2>
        <div style={S.grid}>
          <div style={S.card}>
            <h3 style={S.cardH}>Luôn hiện lựa chọn không tài trợ</h3>
            <p style={S.cardP}>
              Danh sách công cụ luôn kèm phương án miễn phí / tự host, đánh dấu rõ.
            </p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>Không bán thứ hạng</h3>
            <p style={S.cardP}>
              Xếp theo độ phù hợp kỹ thuật. Tài trợ chỉ là một nhãn, không mua được vị trí.
            </p>
          </div>
          <div style={S.card}>
            <h3 style={S.cardH}>Chỉ hiện khi được hỏi</h3>
            <p style={S.cardP}>
              Agent không tự tạo nhu cầu. Người dùng hỏi thì mới có danh sách.
            </p>
          </div>
        </div>
        <p style={S.note}>
          Agent là cố vấn kỹ thuật được tin tưởng. Bán lời khuyên của nó là bán lòng tin,
          mà lòng tin chỉ bán được một lần.
        </p>
      </section>
    </main>
  );
}
