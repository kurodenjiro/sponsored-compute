'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const tools = [
  { name: 'AWS Lambda', category: 'serverless', fit: 'Best match', funded: '2.00 XSGD', reward: '0.14 XSGD', detail: 'Run event-driven backend tasks without operating servers.' },
  { name: 'Amazon Bedrock', category: 'AI', fit: 'Strong match', funded: '1.20 XSGD', reward: '0.09 XSGD', detail: 'Add foundation-model inference to the product workflow.' },
  { name: 'Amazon RDS', category: 'database', fit: 'Good match', funded: '0.80 XSGD', reward: '0.06 XSGD', detail: 'Operate the application data layer in a managed relational database.' },
];
const demoTiming = { start: 1_400, thinking: 1_800, choose: 2_000, build: 3_200 };

export default function Home() {
  const prompt = 'Design an AWS-hosted AI onboarding flow funded with StraitsX XSGD credits.';
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState(false);
  const [selected, setSelected] = useState<typeof tools[number] | null>(null);
  const [building, setBuilding] = useState(false);
  const [rewarded, setRewarded] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || nextPrompt === submittedPrompt || searching || building) return;
    const timer = window.setTimeout(() => {
      setSubmittedPrompt(nextPrompt);
      setMatches(false); setSelected(null); setRewarded(false); setSearching(true);
      window.setTimeout(() => { setSearching(false); setMatches(true); }, demoTiming.thinking);
    }, demoTiming.start);
    return () => window.clearTimeout(timer);
  }, [prompt, submittedPrompt, searching, building]);
  const choose = (tool: typeof tools[number]) => {
    setSelected(tool); setBuilding(true); setRewarded(false);
    window.setTimeout(() => { setBuilding(false); setRewarded(true); }, demoTiming.build);
  };
  useEffect(() => {
    if (!matches || selected) return;
    const timer = window.setTimeout(() => choose(tools[0]), demoTiming.choose);
    return () => window.clearTimeout(timer);
  }, [matches, selected]);
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const frame = window.requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [submittedPrompt, searching, matches, selected, building, rewarded]);

  return <main className="site">
    <nav><Link href="/" className="brand">sponsored<span>compute</span></Link><div><a href="#flow">How it works</a><Link href="/merchant">Merchant</Link><Link href="/sponsor">Sponsor</Link></div><small><i /> FUJI LIVE</small></nav>
    <section className="hero"><p className="eyebrow">XSGD · AVALANCHE · x402 · PURPOSE-BOUND GRANTS</p><h1>Fund the build.<br /><em>Not the loophole.</em></h1><p>Developer credits an AI agent can spend only where the sponsor intended — per call, on-chain, with a hard stop.</p><div className="actions"><a href="#flow">Try the agent flow ↓</a><Link href="/sponsor">Sponsor a campaign ↗</Link></div><aside><span>AGENT / MCP</span><b>Grant #1</b><span>AVAILABLE</span><strong>0.14 XSGD</strong><small>allowlist · per-tx cap · daily cap · expiry</small></aside></section>
    <div className="ticker"><span>NO CARD REQUIRED</span><i>◆</i><span>AGENT-SAFE CHECKPOINT</span><i>◆</i><span>XSGD SETTLES ON-CHAIN</span></div>
    <section id="flow" className="flow"><div><p className="eyebrow">THE PRODUCT, IN ONE CONVERSATION</p><h2>Ask normally.<br />Pay deliberately.</h2><p>The user describes the job. The agent finds funded tools, builds with the selected one, and returns the reward only after the work is complete.</p></div><div className="terminal"><header><span>agent session · sponsored-compute</span><span>secure checkpoint</span></header><div className="session-state"><span>LIVE AGENT THREAD</span><b>{rewarded ? 'reward released' : building ? 'build checkpoint' : matches ? 'tools matched' : searching ? 'agent is thinking' : 'ready'}</b></div>
      <div className="conversation thread" ref={threadRef}>
        <p className="agent"><b>sponsored agent</b>I&apos;m mapping an AWS build plan to purpose-bound StraitsX XSGD credits. I&apos;ll show the funded path and developer reward before the agent spends.</p>
        {searching && <p className="agent typing"><b>sponsored agent</b><span /><span /><span /></p>}
        {matches && <div className="agent tool-message"><b>sponsored agent</b><p>Demo scenario: AWS services are ranked by technical fit; XSGD funding and reward are enforced by the Sponsored Compute flow. I&apos;ll use the strongest match automatically.</p><div className="tool-list">{tools.map((tool) => <button className={`tool ${selected?.name === tool.name ? 'picked' : ''}`} key={tool.name} disabled><span><b>{tool.name}</b><small>{tool.category} · {tool.fit} · funded {tool.funded}</small><em>{tool.detail}</em></span><strong>{tool.reward}<small>reward</small></strong></button>)}</div></div>}
        {selected && <p className="agent recommendation"><b>sponsored agent</b>Best match selected: {selected.name}.</p>}
        {selected && <p className="agent"><b>sponsored agent</b>{building ? `Checkpoint accepted. ${selected.name} is running within the funded cap…` : `Build complete with ${selected.name}. The exact spend was verified.`}</p>}
        {building && <div className="progress"><span className="running" /></div>}
        {rewarded && <div className="reward"><span>✓</span><div><b>Reward released</b><p>{selected?.name} completed the requested build.</p></div><strong>{selected?.reward}<small>earned</small></strong></div>}
      </div><footer>✦ checkpoint runs before signing <span>{rewarded ? '✓ settlement recorded' : 'funding rules stay fixed'}</span></footer>
    </div></section>
    <section className="boundaries"><p className="eyebrow">WHY IT DOESN’T LEAK</p><h2>A credit should act<br />like a commitment.</h2><div>{[['01', 'The merchant is fixed.', 'Owner-approved registry allowlist.'], ['02', 'The amount is fixed.', 'Caller, daily, vested and per-tx caps.'], ['03', 'The end is fixed.', 'Expiry, revoke and exhausted credit stop it.']].map(x => <article key={x[0]}><b>{x[0]}</b><h3>{x[1]}</h3><p>{x[2]}</p></article>)}</div></section>
    <section className="closing"><div><p className="eyebrow">ONE DEPLOYMENT · THREE SURFACES</p><h2>Spend XSGD<br /><em>with intent.</em></h2></div><div><Link href="/sponsor">Open sponsor console ↗</Link><Link href="/merchant">Open merchant dashboard ↗</Link></div></section>
    <style jsx>{`
      :global(*){box-sizing:border-box}:global(body){margin:0;background:#0d0f0b;color:#f4f6ed;font-family:'Helvetica Neue',Helvetica,sans-serif}.site{overflow:hidden;background:radial-gradient(ellipse 75% 45% at 50% 0%,#21331c 0%,#0d0f0b 68%);min-height:100vh}nav{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 4.5vw;border-bottom:1px solid #354031;font:11px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}.brand{font:800 17px 'Helvetica Neue';letter-spacing:-.07em;color:#f4f6ed;text-decoration:none;text-transform:none}.brand span,.eyebrow,nav small{color:#c8ff45}nav div{display:flex;gap:24px}nav a{color:#b8bdb1;text-decoration:none}nav small{display:flex;gap:7px;align-items:center}nav i{width:7px;height:7px;border-radius:99px;background:#c8ff45;box-shadow:0 0 12px #c8ff45}.hero{max-width:1200px;margin:auto;padding:106px 34px 70px;position:relative}.eyebrow{font:700 11px ui-monospace,monospace;letter-spacing:.11em}.hero h1,.flow h2,.boundaries h2,.closing h2{font-size:clamp(62px,10vw,142px);line-height:.82;letter-spacing:-.085em;margin:18px 0;font-weight:800}.hero em,.closing em{font-style:normal;color:#c8ff45}.hero>p:not(.eyebrow){font-size:20px;line-height:1.45;max-width:575px;color:#c8cec1}.actions{display:flex;gap:12px;margin-top:32px}.actions a,.closing a{padding:15px 18px;background:#c8ff45;color:#10130d;text-decoration:none;font-weight:700;font-size:14px;border-radius:2px}.actions a+a,.closing a+a{background:transparent;color:#e8eee0;border:1px solid #66705e}.hero aside{position:absolute;right:3vw;bottom:54px;width:264px;display:grid;grid-template-columns:1fr auto;gap:13px 8px;padding:19px;border:1px solid #6b785f;background:#141a12;box-shadow:9px 9px #c8ff45;font:10px ui-monospace,monospace}.hero aside span{color:#aeb8a7}.hero aside strong{color:#c8ff45;font-size:19px}.hero aside small{grid-column:1/-1;color:#798273}.ticker{white-space:nowrap;overflow:hidden;border-block:1px solid #c8ff45;background:#c8ff45;color:#11140e;padding:14px;font:800 12px ui-monospace,monospace;letter-spacing:.09em}.flow,.boundaries{max-width:1200px;margin:auto;padding:145px 34px;display:grid;grid-template-columns:360px 1fr;gap:72px}.flow h2,.boundaries h2{font-size:55px}.flow>div>p:last-child{color:#aeb7a7;line-height:1.55}.terminal{border:1px solid #3e4939;background:#11150f;box-shadow:12px 12px #24321f;font-family:ui-monospace,monospace}.terminal header,.terminal footer{padding:15px 16px;display:flex;justify-content:space-between;color:#8b9784;font-size:10px}.terminal header,.tabs{border-bottom:1px solid #354031}.tabs{display:flex}.tabs button{flex:1;padding:13px;border:0;border-right:1px solid #354031;background:none;color:#849078;font:10px ui-monospace,monospace;cursor:pointer}.tabs b{display:block;color:#c8ff45}.tabs .on{background:#c8ff45;color:#10130d;font-weight:bold}.tabs .on b{color:#10130d}.conversation{min-height:330px;padding:28px 30px}.conversation>small{color:#c8ff45}.conversation textarea{display:block;width:100%;min-height:92px;resize:vertical;margin:17px 0 12px;padding:15px;background:#20291b;border:1px solid #46523e;color:#f4f6ed;font:14px/1.5 ui-monospace,monospace;outline:0}.conversation textarea:focus{border-color:#c8ff45;box-shadow:0 0 0 3px #c8ff4522}.primary,.secondary{padding:13px 15px;border:1px solid #c8ff45;background:#c8ff45;color:#10130d;font:700 12px ui-monospace,monospace;cursor:pointer}.secondary{background:transparent;color:#c8ff45}.hint{color:#75816f;font-size:11px}.user,.agent{padding:13px 15px;line-height:1.5;font-size:13px}.user{margin:16px 0 12px;background:#283124}.agent{margin-top:14px;background:#171d15;border:1px solid #3e4939}.agent b{display:block;font:10px ui-monospace,monospace;color:#c8ff45;margin-bottom:5px}.tool-list{display:grid;gap:8px}.tool{width:100%;display:flex;align-items:center;justify-content:space-between;text-align:left;padding:13px 14px;border:1px solid #3e4939;background:#171d15;color:#f4f6ed;cursor:pointer}.tool:hover,.tool.picked{border-color:#c8ff45;background:#20291b}.tool b,.tool strong{display:block}.tool small{display:block;margin-top:4px;color:#91a08c;font:10px ui-monospace,monospace}.tool strong{color:#c8ff45;text-align:right}.progress{height:5px;margin:22px 0;background:#26321f;overflow:hidden}.progress span{display:block;width:100%;height:100%;background:#c8ff45;transform:scaleX(0);transform-origin:left}.progress span.running{animation:build 3.2s ease forwards}@keyframes build{to{transform:scaleX(1)}}.reward{display:flex;align-items:center;gap:14px;margin:18px 0;padding:18px;border:1px solid #c8ff45;background:#20291b}.reward>span{font-size:25px;color:#c8ff45}.reward b{font-size:15px}.reward p{margin:5px 0 0;color:#aeb8a7;font-size:11px}.reward>strong{margin-left:auto;color:#c8ff45;text-align:right}.reward small{display:block;color:#8c9a82;font:10px ui-monospace,monospace}.terminal footer{border-top:1px solid #354031;color:#c8ff45}.terminal footer span{color:#95a08d}.boundaries{display:block;border-top:1px solid #30382b}.boundaries>div{display:grid;grid-template-columns:repeat(3,1fr);margin-top:70px;border-top:1px solid #3e4939}.boundaries article{padding:24px 28px 0 0;margin-right:26px;border-right:1px solid #3e4939}.boundaries article:last-child{border:0}.boundaries article>b{color:#c8ff45;font:12px ui-monospace,monospace}.boundaries h3{font-size:26px;letter-spacing:-.04em}.boundaries article p{color:#aeb7a7;line-height:1.55}.closing{padding:120px 7vw;display:grid;grid-template-columns:1fr .55fr;gap:60px;background:#c8ff45;color:#10140d}.closing .eyebrow{color:#405018}.closing h2{font-size:clamp(56px,8vw,112px)}.closing em{color:#10140d}.closing>div:last-child{align-self:end;display:grid;gap:12px}@media(max-width:850px){nav div{display:none}.hero aside{position:relative;right:auto;bottom:auto;margin-top:58px}.flow{grid-template-columns:1fr;padding-block:90px}.boundaries>div,.closing{grid-template-columns:1fr}.boundaries article{border-right:0;border-bottom:1px solid #3e4939}.closing{padding:90px 34px}}@media(max-width:520px){.hero,.flow,.boundaries{padding-inline:20px}.hero h1{font-size:64px}.actions{flex-wrap:wrap}.flow h2,.boundaries h2{font-size:48px}.closing{padding:70px 20px}}
    `}</style>
  </main>;
}
