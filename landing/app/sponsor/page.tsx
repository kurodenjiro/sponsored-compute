'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

const address = '0x3230B5666d8De86d3079D07bb45A7075A1d0b043';
const isBytes32 = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

export default function SponsorPortal() {
  const [merchant, setMerchant] = useState('SupaDB');
  const [payTo, setPayTo] = useState('0xd077E3f3048AD97C50A08a31a95F4918278B31ac');
  const [campaign, setCampaign] = useState('');
  const [grant, setGrant] = useState('2.00');
  const ready = /^0x[0-9a-fA-F]{40}$/.test(payTo) && isBytes32(campaign) && Number(grant) > 0;
  const snippet = useMemo(() => ready
    ? `npx -y @sponsored-compute/cli init --campaign ${campaign} --sponsor ${merchant.toLowerCase().replace(/\s+/g, '-')} --chain 43113`
    : 'Hoàn thiện các trường để tạo lệnh cài đặt', [campaign, merchant, ready]);

  return <main className="shell">
    <nav><Link href="/">← Sponsored Compute</Link><span>FUJI / 43113</span></nav>
    <section className="hero">
      <p className="eyebrow">SPONSOR CONSOLE · OWNER ACTIONS</p>
      <h1>Đặt XSGD vào<br /><em>đúng nơi cần chạy.</em></h1>
      <p className="lede">Một campaign là ngân sách on-chain có ràng buộc: đúng merchant, hạn mức cứng, hết tiền thì API không được trả nữa.</p>
    </section>
    <section className="workflow" aria-label="Campaign workflow">
      <article><b>01</b><h2>Duyệt merchant</h2><p>Admin xác minh endpoint và ví nhận tiền, rồi ghi vào allowlist.</p></article>
      <article><b>02</b><h2>Tạo campaign</h2><p>Sponsor đặt ngân sách, tranche, hạn dùng và các cap.</p></article>
      <article><b>03</b><h2>Phát grant</h2><p>Mỗi project ID chỉ nhận một Grant — clone repo không nhân bản tiền.</p></article>
    </section>
    <section className="board">
      <div className="panel form">
        <p className="eyebrow">CAMPAIGN DRAFT</p>
        <label>Merchant đã duyệt<input value={merchant} onChange={e => setMerchant(e.target.value)} /></label>
        <label>Ví nhận XSGD <input value={payTo} onChange={e => setPayTo(e.target.value)} spellCheck="false" /></label>
        <label>Campaign ID (bytes32)<input value={campaign} placeholder="0x…" onChange={e => setCampaign(e.target.value.trim())} spellCheck="false" /></label>
        <label>Grant mỗi developer (XSGD)<input value={grant} inputMode="decimal" onChange={e => setGrant(e.target.value)} /></label>
        <p className={ready ? 'ok' : 'hint'}>{ready ? '✓ Cấu hình hợp lệ để tạo onboarding' : 'Cần địa chỉ ví hợp lệ, campaign ID bytes32 và Grant > 0.'}</p>
      </div>
      <div className="panel ledger">
        <p className="eyebrow">EXECUTION BOUNDARY</p>
        <dl><dt>GrantManager</dt><dd><code>{address}</code></dd><dt>Network</dt><dd>Avalanche Fuji · 43113</dd><dt>Người ký</dt><dd>Ví owner của MerchantRegistry / sponsor</dd></dl>
        <p className="warning">Portal này không giữ private key và không tự gửi tiền. Các hành động on-chain phải được owner ký rõ ràng bằng script hoặc ví của họ.</p>
        <p className="eyebrow">DEVELOPER INSTALL</p><pre>{snippet}</pre>
      </div>
    </section>
    <section className="runbook"><h2>Runbook cho admin</h2><ol><li>Chạy <code>contracts/scripts/register.ts</code> bằng ví owner để approve merchant.</li><li>Tạo và nạp campaign bằng <code>scripts/seed.ts</code> (mỗi sponsor một campaign).</li><li>Gửi lệnh cài đặt ở trên cho repo developer; MCP chỉ chi qua checkpoint + Grant.</li></ol></section>
    <style jsx>{`
      :global(body){background:#0d1110;color:#e8e5d8;font-family:Georgia,'Times New Roman',serif}.shell{max-width:1120px;margin:auto;padding:26px 28px 90px;background:radial-gradient(circle at 88% 12%,#1a3b31 0,transparent 26%),#0d1110;min-height:100vh}nav{display:flex;justify-content:space-between;font:11px ui-monospace,monospace;letter-spacing:.09em;color:#9db2a8}nav a{color:#d5e8b9;text-decoration:none}.hero{padding:72px 0 44px;max-width:760px}.eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.13em;color:#b9d87a;margin:0 0 12px}.hero h1{font-size:clamp(44px,8vw,88px);line-height:.9;letter-spacing:-.06em;margin:0}.hero em{color:#c9ec8d;font-weight:normal}.lede{font-size:19px;line-height:1.55;color:#b9c3b9;max-width:650px}.workflow{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #405047;border-bottom:1px solid #405047}.workflow article{padding:22px 22px 26px;border-right:1px solid #405047}.workflow article:last-child{border:0}.workflow b{font:13px ui-monospace,monospace;color:#d8ff9d}.workflow h2{font-size:21px;margin:13px 0 7px}.workflow p,.runbook li{color:#a9b4ab;line-height:1.5}.board{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:40px}.panel{background:#141b18;border:1px solid #3a493f;padding:27px}.form label{display:block;font:12px ui-monospace,monospace;color:#b8c5bb;margin:0 0 17px}.form input{box-sizing:border-box;width:100%;margin-top:7px;padding:11px;border:1px solid #46594d;background:#0b0f0d;color:#f0eedf;font:13px ui-monospace,monospace}.hint{font-size:13px;color:#8c978f}.ok{color:#c9ec8d}.ledger dl{font-size:15px}.ledger dt{color:#84948a;margin-top:15px}.ledger dd{margin:3px 0;overflow-wrap:anywhere}.ledger code{font:12px ui-monospace,monospace}.warning{border-left:3px solid #d8c26b;padding:8px 12px;background:#252417;color:#ded7aa;line-height:1.5;font-size:14px}.ledger pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0a0e0c;padding:13px;color:#dbf1bd;font:12px/1.5 ui-monospace,monospace}.runbook{margin-top:16px;padding:27px;border:1px dashed #536558}.runbook h2{margin-top:0;font-size:26px}.runbook code{color:#d9f19e}@media(max-width:720px){.workflow,.board{grid-template-columns:1fr}.workflow article{border-right:0;border-bottom:1px solid #405047}.shell{padding:18px}.hero{padding-top:50px}}
    `}</style>
  </main>;
}
