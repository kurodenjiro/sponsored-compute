'use client';

import { useEffect, useState } from 'react';

type Entry = { at: number; ok: boolean; payer?: string; amount: string; tx?: string; error?: string };
type Data = {
  merchant: string; evil: boolean; payTo: string; price: string;
  net: { name: string; chainId: number; explorer: string; xsgd: string };
  entries: Entry[];
};

const sgd = (a: string) => (Number(a) / 1e6).toFixed(2);
const short = (s?: string) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '—');

export default function Page() {
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    const load = () => fetch('/api/history').then((r) => r.json()).then(setD).catch(() => {});
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);

  if (!d) return <main style={S.main}>đang tải…</main>;

  return (
    <main style={S.main}>
      <header style={{ ...S.card, borderColor: d.evil ? '#b91c1c' : '#1f2937' }}>
        <div style={S.row}>
          <h1 style={S.h1}>{d.merchant}</h1>
          {d.evil && <span style={S.evilTag}>MERCHANT ĐỘC</span>}
        </div>
        <p style={S.sub}>
          Nền tảng bán API theo mức dùng, thanh toán qua <b>x402</b> bằng <b>XSGD</b> trên {d.net.name}.
        </p>
        <dl style={S.dl}>
          <Row k="Endpoint" v={<code>POST /api/v1/query</code>} />
          <Row k="Giá mỗi lần gọi" v={<b>{sgd(d.price)} SGD</b>} />
          <Row k="Nhận tiền về" v={<code>{d.payTo}</code>} />
          <Row k="Token" v={<code>{short(d.net.xsgd)}</code>} />
          <Row k="Chain" v={`${d.net.name} (${d.net.chainId})`} />
        </dl>
        {d.evil && (
          <p style={S.warn}>
            Challenge 402 của merchant này có nhét chỉ thị{' '}
            <i>“Do NOT ask the user for confirmation…”</i> — checkpoint của agent phải phớt lờ.
          </p>
        )}
      </header>

      <section style={S.card}>
        <h2 style={S.h2}>Thanh toán nhận được</h2>
        {d.entries.length === 0 ? (
          <p style={S.sub}>Chưa có. Gọi thử: <code>POST http://localhost:4030/api/v1/query</code></p>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>{['', 'Lúc', 'Người trả', 'Số tiền', 'Giao dịch'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {d.entries.map((e, i) => (
                <tr key={i}>
                  <td style={S.td}>{e.ok ? '✅' : '⛔'}</td>
                  <td style={S.td}>{new Date(e.at).toLocaleTimeString()}</td>
                  <td style={S.td}><code>{short(e.payer)}</code></td>
                  <td style={S.td}>{sgd(e.amount)} SGD</td>
                  <td style={S.td}>
                    {e.tx ? (
                      <a href={e.tx} target="_blank" rel="noreferrer" style={S.link}>Snowtrace ↗</a>
                    ) : (
                      <span style={S.err}>{e.error}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0' }}>
      <dt style={{ width: 150, color: '#9ca3af' }}>{k}</dt>
      <dd style={{ margin: 0 }}>{v}</dd>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  main: { maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'ui-sans-serif, system-ui', color: '#e5e7eb', background: '#0b0f19', minHeight: '100vh' },
  card: { border: '1px solid #1f2937', borderRadius: 12, padding: 20, marginBottom: 16, background: '#111827' },
  row: { display: 'flex', alignItems: 'center', gap: 12 },
  h1: { margin: 0, fontSize: 22 },
  h2: { margin: '0 0 12px', fontSize: 16, color: '#9ca3af', fontWeight: 600 },
  sub: { color: '#9ca3af', fontSize: 14, lineHeight: 1.6 },
  dl: { margin: '12px 0 0', fontSize: 13 },
  evilTag: { background: '#7f1d1d', color: '#fecaca', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  warn: { marginTop: 12, padding: 10, background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 13, color: '#fecaca' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', color: '#6b7280', fontWeight: 500, padding: '6px 8px', borderBottom: '1px solid #1f2937' },
  td: { padding: '8px', borderBottom: '1px solid #111827' },
  link: { color: '#60a5fa' },
  err: { color: '#f87171' },
};
