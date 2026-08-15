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
    <nav><Link href="/" className="brand">sponsored<span>compute</span></Link><span className="live"><i /> FUJI / 43113</span></nav>
    <section className="hero">
      <p className="eyebrow">SPONSOR CONSOLE · OWNER ACTIONS</p>
      <h1>Put XSGD where<br /><em>it can do the work.</em></h1>
      <p className="lede">Một campaign là ngân sách on-chain có ràng buộc: đúng merchant, hạn mức cứng, hết tiền thì API không được trả nữa.</p>
      <div className="signal"><span>OWNER SIGNS</span><b>→</b><span>GRANTMANAGER ENFORCES</span><b>→</b><span>AGENT SPENDS EXACTLY</span></div>
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
      :global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.shell{min-height:100vh;padding:0 max(4.5vw,24px) 96px;background:radial-gradient(ellipse 72% 42% at 50% 0%,#21331c 0%,#0d0f0b 68%)}nav{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(232,255,196,.18);font:11px ui-monospace,monospace;letter-spacing:.09em;color:#9da89b}.brand{color:#f4f6ed;text-decoration:none;font-size:17px;font-family:'Helvetica Neue',Helvetica,sans-serif;font-weight:800;letter-spacing:-.07em}.brand span{color:#c8ff45}.live{display:flex;align-items:center;gap:7px;color:#c8ff45}.live i{width:7px;height:7px;border-radius:99px;background:#c8ff45;box-shadow:0 0 12px #c8ff45}.hero{padding:92px 0 62px;max-width:900px}.eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.13em;color:#c8ff45;margin:0 0 15px}.hero h1{font-size:clamp(52px,8vw,108px);line-height:.82;letter-spacing:-.08em;margin:0}.hero em{color:#c8ff45;font-style:normal}.lede{font-size:19px;line-height:1.55;color:#bbc5b5;max-width:650px;margin:30px 0}.signal{display:flex;gap:12px;flex-wrap:wrap;align-items:center;color:#c8ff45;font:10px ui-monospace,monospace;letter-spacing:.04em}.signal b{color:#7f8b78}.workflow{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #394233;border-bottom:1px solid #394233}.workflow article{padding:27px 28px 30px 0;margin-right:28px;border-right:1px solid #394233}.workflow article:last-child{border:0}.workflow b{font:13px ui-monospace,monospace;color:#c8ff45}.workflow h2{font-size:26px;letter-spacing:-.045em;margin:25px 0 8px}.workflow p,.runbook li{color:#aeb8a8;line-height:1.5}.board{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:58px;border:1px solid #3d4738;background:#3d4738}.panel{background:#151a13;padding:30px}.form label{display:block;font:11px ui-monospace,monospace;letter-spacing:.05em;color:#aeb9a7;margin:0 0 20px}.form input{box-sizing:border-box;width:100%;margin-top:8px;padding:13px 12px;border:1px solid #46523e;background:#0e120d;color:#f3f6eb;font:13px ui-monospace,monospace;outline:none;transition:border-color .2s,box-shadow .2s}.form input:focus{border-color:#c8ff45;box-shadow:0 0 0 3px rgba(200,255,69,.12)}.hint{font:12px ui-monospace,monospace;color:#84907d}.ok{font:12px ui-monospace,monospace;color:#c8ff45}.ledger dl{font-size:15px}.ledger dt{color:#84907d;margin-top:18px;font:10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.ledger dd{margin:5px 0;overflow-wrap:anywhere}.ledger code{font:12px ui-monospace,monospace;color:#d8e7ce}.warning{border-left:3px solid #c8ff45;padding:10px 13px;background:#20291a;color:#dce9d1;line-height:1.5;font-size:14px}.ledger pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0d110c;border:1px solid #394233;padding:15px;color:#d9ff7a;font:12px/1.6 ui-monospace,monospace}.runbook{margin-top:18px;padding:31px;border-top:1px solid #53604d;border-bottom:1px solid #53604d}.runbook h2{margin:0 0 20px;font-size:30px;letter-spacing:-.045em}.runbook code{color:#c8ff45;font:12px ui-monospace,monospace}@media(max-width:720px){.workflow,.board{grid-template-columns:1fr}.workflow article{border-right:0;border-bottom:1px solid #394233;margin-right:0}.shell{padding-left:20px;padding-right:20px}.hero{padding-top:65px}.signal{line-height:1.7}}
    `}</style>
  </main>;
}
