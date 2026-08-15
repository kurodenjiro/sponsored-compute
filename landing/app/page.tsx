'use client';

import Link from 'next/link';
import { useState } from 'react';

const steps = [
  {
    tag: '01 · USER PROMPT',
    prompt: 'Tôi cần database cho MVP. Có lựa chọn nào phù hợp và được tài trợ không?',
    result: ['PostgreSQL tự host', '92/100 · không tài trợ', 'SupaDB', '88/100 · tài trợ 2.00 XSGD'],
  },
  {
    tag: '02 · PAYMENT CHECKPOINT',
    prompt: 'Dùng SupaDB, nhưng đừng vượt 0.12 XSGD cho lần gọi này.',
    result: ['merchant', 'SupaDB ✓ allowlisted', 'maximum', '0.12 XSGD ✓ within grant'],
  },
  {
    tag: '03 · RECEIPT',
    prompt: 'Gọi API và chỉ thanh toán nếu challenge hợp lệ.',
    result: ['HTTP 200', '0.12 XSGD settled', 'guard', 'wrong merchant → blocked'],
  },
];

export default function Home() {
  const [active, setActive] = useState(0);
  const current = steps[active];

  return (
    <main className="site">
      <nav className="nav">
        <Link href="/" className="brand">sponsored<span>compute</span></Link>
        <div className="navlinks"><a href="#how">How it works</a><a href="#prompt">Try the flow</a><Link href="/sponsor">For sponsors</Link></div>
        <span className="status"><i /> FUJI LIVE</span>
      </nav>

      <section className="hero">
        <p className="kicker">XSGD · AVALANCHE · x402 · PURPOSE-BOUND GRANTS</p>
        <h1>Fund the build.<br /><em>Not the loophole.</em></h1>
        <p className="lead">Developer credits that an AI agent can spend only where the sponsor intended — per call, on-chain, with a hard stop.</p>
        <div className="heroactions"><a href="#prompt" className="primary">See a payment prompt <b>↓</b></a><Link href="/sponsor" className="secondary">Sponsor a campaign <b>↗</b></Link></div>
        <div className="receipt"><span>AGENT / MCP</span><strong>Grant #1</strong><span>AVAILABLE</span><b>0.14 XSGD</b><small>merchant allowlist · per-tx cap · daily cap · expiry</small></div>
      </section>

      <div className="ticker"><div>NO CARD REQUIRED <b>◆</b> AGENT-SAFE CHECKPOINT <b>◆</b> XSGD SETTLES ON-CHAIN <b>◆</b> NO CARD REQUIRED <b>◆</b> AGENT-SAFE CHECKPOINT <b>◆</b> XSGD SETTLES ON-CHAIN <b>◆</b></div></div>

      <section id="prompt" className="promptSection">
        <div className="sectionHead"><p className="kicker">THE PRODUCT, IN ONE CONVERSATION</p><h2>Ask normally.<br />Pay deliberately.</h2><p>The language model can suggest. It never gets to rewrite the payment rules.</p></div>
        <div className="terminal" aria-label="Payment prompt walkthrough">
          <div className="terminalTop"><span className="dots"><i /><i /><i /></span><span>agent session · sponsored-compute</span><span>secure checkpoint</span></div>
          <div className="stepRail">
            {steps.map((step, i) => <button key={step.tag} className={i === active ? 'selected' : ''} onClick={() => setActive(i)}><b>0{i + 1}</b>{i === 0 ? 'Discover' : i === 1 ? 'Validate' : 'Settle'}</button>)}
          </div>
          <div className="conversation">
            <p className="role">{current.tag}</p>
            <div className="bubble user"><span>you</span>{current.prompt}</div>
            <div className="bubble agent"><span>agent</span><div className="answer"><p>{active === 0 ? '3 sponsored · 2 not sponsored. Ranked by technical fit — never by sponsorship.' : active === 1 ? 'Challenge received. Checking immutable grant conditions outside the model context…' : 'Payment requirement verified. Unwrapping only the exact permitted amount.'}</p><div className="factGrid"><b>{current.result[0]}</b><span>{current.result[1]}</span><b>{current.result[2]}</b><span>{current.result[3]}</span></div></div></div>
          </div>
          <div className="terminalFoot"><span>✦ checkpoint runs before signing</span><span>{active === 2 ? '✓ settlement recorded' : 'ready for next step'}</span></div>
        </div>
      </section>

      <section id="how" className="rules">
        <p className="kicker">WHY IT DOESN’T LEAK</p>
        <div className="ruleIntro"><h2>A credit should act<br />like a commitment.</h2><p>GrantManager holds the XSGD. The agent receives only an exact, short-lived payment path after every constraint agrees.</p></div>
        <div className="ruleGrid">
          <article><b>01</b><h3>The merchant is fixed.</h3><p>Every `payTo` is checked against an owner-approved on-chain registry. A poisoned 402 response cannot redirect funds.</p></article>
          <article><b>02</b><h3>The amount is fixed.</h3><p>Caller maximum, per-transaction cap, daily cap, and vested balance must all permit the exact number.</p></article>
          <article><b>03</b><h3>The end is fixed.</h3><p>Expiry, sponsor revoke, and exhausted credit stop the service. No silent fallback card charge.</p></article>
        </div>
      </section>

      <section className="closing"><p className="kicker">FOR DEVELOPERS AND THE PEOPLE FUNDING THEM</p><h2>Spend XSGD<br /><em>with intent.</em></h2><div><p>Real stablecoin, purpose-bound at the moment it leaves the pool.</p><Link href="/sponsor" className="primary">Open sponsor console <b>↗</b></Link></div></section>
      <footer><span>© 2026 Sponsored Compute</span><span>PBM-compatible subset · Avalanche Fuji</span><span>Built for agents that need boundaries.</span></footer>

      <style jsx>{`
        :global(*){box-sizing:border-box}:global(html){scroll-behavior:smooth}:global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.site{overflow:hidden;background:radial-gradient(ellipse 75% 45% at 50% 0%,#21331c 0%,#0d0f0b 68%);min-height:100vh}.nav{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 4.5vw;border-bottom:1px solid rgba(232,255,196,.18);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}.brand{color:#f4f6ed;text-decoration:none;font-family:'Helvetica Neue',Helvetica,sans-serif;font-size:17px;font-weight:800;letter-spacing:-.07em;text-transform:none}.brand span{color:#c8ff45}.navlinks{display:flex;gap:28px}.navlinks a{color:#b8bdb1;text-decoration:none;transition:color .2s}.navlinks a:hover{color:#c8ff45}.status{color:#c8ff45;display:flex;gap:7px;align-items:center}.status i{width:7px;height:7px;border-radius:50%;background:#c8ff45;box-shadow:0 0 14px #c8ff45}.hero{max-width:1200px;margin:auto;padding:106px 34px 70px;position:relative}.kicker{margin:0 0 18px;color:#c8ff45;font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.11em}.hero h1,.sectionHead h2,.ruleIntro h2,.closing h2{font-size:clamp(62px,10vw,142px);line-height:.82;letter-spacing:-.085em;margin:0;font-weight:800}.hero h1 em,.closing h2 em{font-style:normal;color:#c8ff45}.lead{font-size:20px;line-height:1.45;max-width:575px;margin:35px 0;color:#c8cec1}.heroactions{display:flex;gap:12px;flex-wrap:wrap}.primary,.secondary{padding:15px 18px;text-decoration:none;font-weight:700;font-size:14px;border-radius:3px;transition:transform .2s}.primary{color:#10130d;background:#c8ff45}.secondary{border:1px solid #66705e;color:#e8eee0}.primary:hover,.secondary:hover{transform:translateY(-3px)}.primary b,.secondary b{margin-left:18px}.receipt{position:absolute;right:3vw;bottom:54px;width:264px;display:grid;grid-template-columns:1fr auto;gap:13px 8px;padding:19px;border:1px solid #6b785f;background:#141a12;box-shadow:9px 9px 0 #c8ff45;font:10px ui-monospace,monospace;letter-spacing:.04em}.receipt span{color:#aeb8a7}.receipt strong{font-size:11px}.receipt b{color:#c8ff45;font-size:19px}.receipt small{grid-column:1/-1;color:#798273;line-height:1.5}.ticker{border-top:1px solid #c8ff45;border-bottom:1px solid #c8ff45;background:#c8ff45;color:#11140e;white-space:nowrap;overflow:hidden;font:800 13px ui-monospace,monospace;letter-spacing:.08em;padding:14px 0}.ticker div{width:max-content;animation:roll 23s linear infinite}.ticker b{padding:0 20px}@keyframes roll{to{transform:translateX(-50%)}}.promptSection,.rules{max-width:1200px;margin:auto;padding:145px 34px}.promptSection{display:grid;grid-template-columns:360px 1fr;gap:72px}.sectionHead h2,.ruleIntro h2{font-size:55px}.sectionHead>p:last-child{color:#aeb7a7;line-height:1.55;max-width:310px}.terminal{border:1px solid #3e4939;background:#11150f;box-shadow:12px 12px 0 #24321f;min-height:480px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.terminalTop,.terminalFoot{height:44px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;color:#8b9784;font-size:10px;border-bottom:1px solid #354031}.terminalFoot{border-top:1px solid #354031;border-bottom:0;color:#c8ff45}.dots{display:flex;gap:5px}.dots i{width:7px;height:7px;background:#66705e;border-radius:50%}.stepRail{display:flex;border-bottom:1px solid #354031}.stepRail button{flex:1;background:none;border:0;border-right:1px solid #354031;color:#849078;padding:13px 6px;font:10px ui-monospace,monospace;cursor:pointer}.stepRail button:last-child{border:0}.stepRail button b{display:block;color:#c8ff45;margin-bottom:5px}.stepRail button.selected{color:#0e120c;background:#c8ff45;font-weight:700}.stepRail button.selected b{color:#0e120c}.conversation{padding:30px;min-height:346px}.role{color:#c8ff45;font-size:10px;font-weight:bold;letter-spacing:.1em}.bubble{max-width:90%;padding:14px 16px;margin-top:14px;font-size:14px;line-height:1.55}.bubble span{display:block;font-size:10px;color:#899584;margin-bottom:6px}.user{margin-left:auto;background:#283124}.agent{background:#171d15;border:1px solid #3e4939}.answer p{margin:0 0 14px}.factGrid{display:grid;grid-template-columns:115px 1fr;gap:4px 10px;color:#adb7a5;font-size:11px}.factGrid b{color:#dce7d5;font-weight:500}.terminalFoot span:last-child{color:#95a08d}.rules{border-top:1px solid #30382b}.ruleIntro{display:grid;grid-template-columns:1.25fr .75fr;gap:55px;align-items:end}.ruleIntro p{color:#adb7a5;font-size:18px;line-height:1.5;margin:0 0 5px}.ruleGrid{display:grid;grid-template-columns:repeat(3,1fr);margin-top:80px;border-top:1px solid #3e4939}.ruleGrid article{padding:24px 28px 0 0;margin-right:26px;border-right:1px solid #3e4939}.ruleGrid article:last-child{border:0}.ruleGrid b{font:12px ui-monospace,monospace;color:#c8ff45}.ruleGrid h3{font-size:26px;letter-spacing:-.04em;margin:30px 0 12px}.ruleGrid p{color:#aeb7a7;line-height:1.55;max-width:280px}.closing{padding:120px 7vw;display:grid;grid-template-columns:1fr .55fr;gap:60px;background:#c8ff45;color:#10140d}.closing .kicker{color:#405018}.closing h2{font-size:clamp(56px,8vw,112px)}.closing h2 em{color:#10140d;text-decoration:underline;text-decoration-thickness:6px;text-underline-offset:7px}.closing>div{align-self:end}.closing>div p{line-height:1.5;font-size:18px;margin:0 0 28px}.closing .primary{background:#10140d;color:#d9ff75;display:inline-block}footer{padding:22px 4.5vw;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;color:#788271;font:10px ui-monospace,monospace;border-top:1px solid #2b3327}@media(max-width:850px){.navlinks{display:none}.hero{padding-top:85px}.receipt{position:relative;right:auto;bottom:auto;margin-top:60px}.promptSection{grid-template-columns:1fr;gap:45px}.terminal{min-height:auto}.ruleIntro,.closing{grid-template-columns:1fr}.ruleGrid{grid-template-columns:1fr;gap:18px}.ruleGrid article{border-right:0;border-bottom:1px solid #3e4939;padding-bottom:20px}.ruleGrid h3{margin:15px 0 8px}}@media(max-width:520px){.nav{padding:0 20px}.status{font-size:9px}.hero,.promptSection,.rules{padding-left:20px;padding-right:20px}.hero h1{font-size:64px}.sectionHead h2,.ruleIntro h2{font-size:48px}.conversation{padding:18px}.bubble{max-width:100%}.closing{padding:90px 20px}.ticker{font-size:10px}}
      `}</style>
    </main>
  );
}
