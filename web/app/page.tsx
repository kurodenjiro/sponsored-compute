'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SiteNav } from '../components/site-nav';

type Grant = {
  id: string;
  name: string;
  category: string;
  note: string;
  fitScore: number;
  campaignId: string;
  chainId: number;
  grantAmountLabel: string;
  availableLabel: string;
  seatsLeft: number;
  perTxCapLabel: string;
  dailyCapLabel: string;
  asset: 0 | 1;
  symbol: 'XSGD' | 'AVAX';
  status: 'open' | 'paused' | 'exhausted';
  repoUrl?: string;
  repoSlug?: string;
};

const promptFor = (grant?: Grant) => {
  if (!grant) return 'Claude, check this repo for a sponsored product grant before you make any change.';
  if (grant.asset === 1) return `Claude, use the ${grant.name} AVAX gas grant to deploy this StoreDB starter to AWS. Check the grant first and ask before claiming gas.`;
  return `Claude, use the ${grant.name} product grant to turn this repo into a working SaaS onboarding flow. Check the grant before any payment.`;
};

export default function Home() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [phase, setPhase] = useState(0);
  const [typedPrompt, setTypedPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string>();
  const [install, setInstall] = useState<{ claude: string; codex: string } | null>(null);
  const [client, setClient] = useState<'claude' | 'codex'>('claude');
  const [copied, setCopied] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const preferredGrant = grants.find((grant) => grant.status === 'open' && grant.asset === 1 && grant.repoSlug?.toLowerCase().includes('storedb')) ?? grants.find((grant) => grant.status === 'open' && grant.asset === 1) ?? grants.find((grant) => grant.status === 'open') ?? grants[0];
  const chosenGrant = grants.find((grant) => grant.campaignId === selectedCampaign);
  const selected = chosenGrant ?? preferredGrant;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/grants').then((response) => response.json()),
      fetch('/api/mcp-install').then((response) => response.json()),
    ]).then(([grantData, installData]) => {
      if (cancelled) return;
      setGrants(Array.isArray(grantData.grants) ? grantData.grants : []);
      setInstall(installData);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timers: number[] = [];
    const intervals: number[] = [];
    let stopped = false;

    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(callback, delay);
      timers.push(timer);
      return timer;
    };

    const runCycle = () => {
      if (stopped) return;
      setPhase(0);
      setSubmitted(false);
      setTypedPrompt('');
      setSubmittedPrompt('');
      setSelectedCampaign(undefined);
      const cycleGrant = preferredGrant;
      const cyclePrompt = promptFor(cycleGrant);

      later(() => {
        setSelectedCampaign(cycleGrant?.campaignId);
      }, 700);

      later(() => {
        let cursor = 0;
        const typing = window.setInterval(() => {
          cursor += 1;
          setTypedPrompt(cyclePrompt.slice(0, cursor));
          if (cursor < cyclePrompt.length) return;
          window.clearInterval(typing);
          later(() => {
            setSubmittedPrompt(cyclePrompt);
            setSubmitted(true);
            [650, 1450, 2500, 3650, 4800, 6100].forEach((delay, index) =>
              later(() => setPhase(index + 1), delay));
            later(runCycle, 12_800);
          }, 450);
        }, 24);
        intervals.push(typing);
      }, 1_500);
    };

    runCycle();
    return () => {
      stopped = true;
      timers.forEach(window.clearTimeout);
      intervals.forEach(window.clearInterval);
    };
  }, [loaded, grants]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: submitted ? 'smooth' : 'auto' });
  }, [phase, submitted, typedPrompt, selectedCampaign]);

  const copyInstall = async () => {
    if (!install) return;
    await navigator.clipboard.writeText(install[client]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const state = !selectedCampaign ? 'selecting product grant' : !submitted ? 'user is typing' : phase >= 6 ? 'settled on-chain' : phase >= 5 ? 'paying with grant' : phase >= 4 ? 'policy checkpoint' : phase >= 2 ? 'calling MCP tools' : phase >= 1 ? 'Claude is working' : 'prompt sent';

  return <main className="site">
    <SiteNav />

    <section className="hero">
      <div className="hero-copy">
        <p className="eyebrow">REPO-NATIVE GRANTS · XSGD · AVALANCHE · x402</p>
        <h1>Grants that<br />travel with the <em>repo.</em></h1>
        <p className="lede">Give vibecoders a funded path from idea to working product. Organizations sponsor the tools they want adopted; Claude and Codex can discover and spend the grant safely, call by call.</p>
        <div className="actions"><a href="#flow">Watch the agent demo ↓</a><Link href="/sponsor">Fund a vibecoding repo ↗</Link></div>
        <div className="proof"><span><b>01</b> clone</span><i>→</i><span><b>02</b> claim</span><i>→</i><span><b>03</b> vibecode</span><i>→</i><span><b>04</b> settle</span></div>
      </div>

      <aside className="grant-radar">
        <header><div><span>AGENT / MCP</span><b>AVAILABLE GRANTS</b></div><small><i /> LIVE ON-CHAIN</small></header>
        <div className="grant-list">
          {!loaded && <p className="grant-empty">Verifying MCP campaigns on GrantManager…</p>}
          {loaded && grants.length === 0 && <p className="grant-empty">No on-chain MCP grant is currently readable. Nothing is substituted with demo data.</p>}
          {grants.map((grant) => <article key={grant.campaignId}>
            <div><strong>{grant.name}</strong><small>{grant.repoSlug ?? grant.category} · fit {grant.fitScore}/100</small></div>
            <div><b>{grant.grantAmountLabel} {grant.symbol}</b><small>{grant.seatsLeft} seats · {grant.status}</small></div>
          </article>)}
        </div>
        <footer><span>{grants.length} verified campaigns</span><span>MCP catalog + GrantManager</span></footer>
      </aside>
    </section>

    <div className="ticker"><span>VIBECODE WITH FUNDED TOOLS</span><i>◆</i><span>ORGANIZATIONS REACH BUILDERS INSIDE THE REPO</span><i>◆</i><span>POLICY BEFORE PAYMENT</span></div>

    <section id="flow" className="flow">
      <div className="flow-copy">
        <p className="eyebrow">LIVE AGENT THREAD · CLAUDE CODE DEMO</p>
        <h2>One prompt.<br /><em>Every action visible.</em></h2>
        <p>This is what a vibecoder sees: Claude discovers the grant attached to the repo, explains the policy checkpoint, pays the merchant via x402, and keeps the transaction traceable.</p>
        <div className="action-key"><span className="key-user">USER</span><span className="key-agent">CLAUDE</span><span className="key-tool">MCP TOOL</span><span className="key-policy">POLICY</span><span className="key-pay">PAYMENT</span></div>
        <div id="install" className="install-inline">
          <div className="install-tabs"><button className={client === 'claude' ? 'on' : ''} onClick={() => setClient('claude')}>Claude Code</button><button className={client === 'codex' ? 'on' : ''} onClick={() => setClient('codex')}>Codex CLI</button></div>
          <pre>{install ? install[client] : 'loading install command…'}</pre>
          <button className="install-copy" disabled={!install} onClick={copyInstall}>{copied ? 'Copied ✓' : 'Copy install command'}</button>
        </div>
      </div>

      <div className="terminal">
        <header><span><i /> claude code · sponsored-compute</span><span>repo session</span></header>
        <div className="session-state"><span>LIVE AGENT THREAD</span><b>{state}</b></div>
        <div className="conversation" ref={threadRef}>
          <div className={`grant-picker ${selectedCampaign ? 'chosen' : ''}`}>
            <header><span>01 · CHOOSE PRODUCT GRANT</span><b>{chosenGrant ? chosenGrant.asset === 1 ? 'AVAX GAS' : 'XSGD PAYMENT' : 'WAITING'}</b></header>
            <p>User chooses the sponsored product before Claude can use any grant.</p>
            <div className="grant-options">
              {grants.length === 0 && <small>Waiting for live campaigns from GrantManager…</small>}
              {grants.map((grant) => <button type="button" key={grant.campaignId} onClick={() => !submitted && setSelectedCampaign(grant.campaignId)} disabled={submitted || grant.status !== 'open'} className={selectedCampaign === grant.campaignId ? 'on' : ''}>
                <span><b>{grant.name}</b><small>{grant.category} · {grant.asset === 1 ? 'gas grant' : 'payment grant'}</small></span><strong>{grant.grantAmountLabel} {grant.symbol}<small>{grant.seatsLeft} seats</small></strong>
              </button>)}
            </div>
            {chosenGrant && <footer>✓ User selected <b>{chosenGrant.name}</b> · campaign {chosenGrant.campaignId.slice(0, 10)}…</footer>}
          </div>
          {!submitted && <div className="composer-demo"><label>YOU</label><div><p>{typedPrompt}<i aria-hidden="true" /></p><button type="button" disabled>{typedPrompt.length > 0 && typedPrompt.length === promptFor(selected).length ? 'SEND' : typedPrompt ? `${typedPrompt.length}` : 'TYPE'}</button></div></div>}
          {submitted && <div className="message user-message sent"><span>YOU · SENT</span><p>{submittedPrompt}</p></div>}
          {phase >= 1 && <div className="message agent-message"><span>CLAUDE</span><p>I’ll inspect the repo sponsorship first, then use only a verified grant. I won’t sign or spend outside its limits.</p></div>}
          {phase >= 2 && <div className="action-card tool-action"><header><span>MCP TOOL CALL</span><code>check_project_sponsorship</code></header><p>Reading <code>sponsored.json</code> and verifying the campaign against GrantManager…</p></div>}
          {phase >= 3 && <div className="action-card tool-result"><header><span>TOOL RESULT</span><b>{selected ? 'VERIFIED' : 'NO ACTIVE GRANT'}</b></header>{selected ? <div className="result-grid"><span>provider <b>{selected.name}</b></span><span>repo <b>{selected.repoSlug ?? 'campaign registry'}</b></span><span>grant <b>{selected.grantAmountLabel} {selected.symbol}</b></span><span>available <b>{selected.availableLabel} {selected.symbol}</b></span></div> : <p>The live registry returned no spendable campaign. Claude stops here instead of inventing one.</p>}</div>}
          {phase >= 4 && selected && <div className="action-card policy-action"><header><span>SECURE CHECKPOINT</span><b>PASS</b></header><div className="checks">{selected.asset === 0 ? <><span>✓ merchant allowlisted</span><span>✓ 0.12 ≤ {selected.perTxCapLabel} XSGD cap</span></> : <><span>✓ native gas mode</span><span>✓ claim ≤ {selected.perTxCapLabel} AVAX cap</span></>}<span>✓ daily cap {selected.dailyCapLabel} {selected.symbol}</span><span>✓ campaign active</span></div></div>}
          {phase >= 5 && selected && <div className="action-card pay-action"><header><span>{selected.asset === 0 ? 'x402 PAYMENT' : 'AVAX GAS CLAIM'}</span><b>{selected.asset === 0 ? '0.12 XSGD' : 'NATIVE AVAX'}</b></header><p>{selected.asset === 0 ? 'Grant unwrap → EIP-3009 signature → merchant retry. The agent never receives an unrestricted budget.' : 'GrantManager releases capped native AVAX to the agent signer for gas. It cannot use this Grant on the x402 payment path.'}</p><div className="pay-line"><span /><span /><span /></div></div>}
          {phase >= 6 && selected && <div className="message agent-message complete"><span>CLAUDE</span><p>{selected.asset === 0 ? `Done — the onboarding flow is connected to ${selected.name}. The merchant call settled from this repo’s grant and the receipt is visible in the merchant ledger.` : `Done — the agent received capped AVAX gas from ${selected.name}. The claim is recorded on-chain and the XSGD payment path stayed disabled.`}</p></div>}
        </div>
        <footer><span>Actions are color-coded by trust boundary</span><b>{phase >= 6 && selected ? '✓ payment recorded' : 'checkpoint runs before signing'}</b></footer>
      </div>
    </section>

    <section className="why">
      <div><p className="eyebrow">WHY THIS CHANGES VIBECODING</p><h2>Distribution<br />meets activation.</h2></div>
      <div className="why-grid">
        <article><b>FOR BUILDERS</b><h3>Start with working credits.</h3><p>Clone a sponsored repo, claim once, and let your coding agent use the right services without setting up cards or copying API keys into chat.</p></article>
        <article><b>FOR ORGANIZATIONS</b><h3>Reach builders at build time.</h3><p>Put grants inside templates and starter repos, where tool choice happens. Fund real usage instead of impressions.</p></article>
        <article><b>FOR BOTH</b><h3>Keep intent enforceable.</h3><p>Merchant allowlists, per-call caps, daily limits, expiry and revocation stay on-chain. The repo points to the grant; it never becomes the permission.</p></article>
      </div>
    </section>

    <section className="closing"><div><p className="eyebrow">SPONSOR THE NEXT WORKING PRODUCT</p><h2>Make the first<br />build <em>possible.</em></h2></div><div><Link href="/sponsor">Create a repo grant ↗</Link><Link href="/merchant">Inspect payments ↗</Link></div></section>

    <style jsx>{`
      :global(*){box-sizing:border-box}:global(body){margin:0;background:#090b09;color:#f5f2e9;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.site{min-height:100vh;overflow:hidden;background:radial-gradient(circle at 78% 12%,#253820 0,transparent 31%),linear-gradient(135deg,#0e120d 0%,#090b09 55%)}
      .eyebrow{margin:0;color:#caff4b;font:800 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em}.hero{max-width:1260px;min-height:760px;margin:auto;padding:112px 38px 80px;display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:75px;align-items:center}.hero h1,.flow h2,.why h2,.closing h2{margin:19px 0 26px;font-size:clamp(64px,8.7vw,126px);line-height:.83;letter-spacing:-.075em;font-weight:850}.hero h1 em,.flow h2 em,.closing h2 em{font-family:Georgia,serif;font-weight:400;color:#caff4b}.lede{max-width:730px;color:#bdc5b8;font-size:19px;line-height:1.55}.actions{display:flex;gap:10px;margin:32px 0}.actions a,.closing a{padding:15px 18px;background:#caff4b;color:#0c1009;text-decoration:none;font-size:13px;font-weight:850;border:1px solid #caff4b}.actions a+*,.closing a+*{background:transparent;color:#eef2e8;border-color:#5c6855}.proof{display:flex;align-items:center;gap:12px;color:#788273;font:10px ui-monospace,monospace;text-transform:uppercase}.proof span{display:grid;gap:3px}.proof b{color:#dfe8d8;font-size:11px}.proof i{color:#46503f;font-style:normal}
      .grant-radar{border:1px solid #5d6b55;background:rgba(13,18,12,.94);box-shadow:13px 13px 0 #caff4b}.grant-radar>header{display:flex;justify-content:space-between;gap:18px;padding:17px;border-bottom:1px solid #394333;font:10px ui-monospace,monospace}.grant-radar>header div{display:grid;gap:4px}.grant-radar>header span{color:#83917c}.grant-radar>header b{font-size:13px;color:#f3f7ec}.grant-radar>header small{color:#caff4b;white-space:nowrap}.grant-radar>header i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#caff4b;box-shadow:0 0 10px #caff4b}.grant-list{max-height:370px;overflow:auto}.grant-list article{display:flex;justify-content:space-between;gap:16px;padding:17px;border-bottom:1px solid #293124}.grant-list article>div{display:grid;gap:5px}.grant-list article>div:last-child{text-align:right}.grant-list strong{font-size:14px}.grant-list b{color:#caff4b;font:800 12px ui-monospace,monospace}.grant-list small{color:#7e8977;font:10px ui-monospace,monospace}.grant-empty{margin:0;padding:28px 18px;color:#91a08b;font:11px/1.6 ui-monospace,monospace}.grant-radar>footer{display:flex;justify-content:space-between;padding:13px 17px;color:#667060;font:9px ui-monospace,monospace;text-transform:uppercase}
      .ticker{display:flex;justify-content:space-around;gap:24px;white-space:nowrap;overflow:hidden;padding:15px;background:#caff4b;color:#0a0d08;font:900 11px ui-monospace,monospace;letter-spacing:.09em}.ticker i{font-style:normal}
      .flow{max-width:1260px;margin:auto;padding:145px 38px;display:grid;grid-template-columns:360px minmax(0,1fr);gap:72px}.flow h2,.why h2{font-size:55px;line-height:.9}.flow-copy>p:not(.eyebrow){color:#aeb8a8;line-height:1.65}.action-key{display:flex;flex-wrap:wrap;gap:7px;margin:22px 0}.action-key span{padding:6px 8px;border:1px solid;font:800 9px ui-monospace,monospace}.key-user{color:#6bc7ff;background:#102331}.key-agent{color:#ff9e57;background:#2b1a10}.key-tool{color:#bc9bff;background:#211936}.key-policy{color:#ffd55a;background:#2b2510}.key-pay{color:#75f0a8;background:#102a1b}
      .install-inline{margin-top:24px;padding:15px;border:1px solid #394333;background:#0e120d;font-family:ui-monospace,monospace}.install-tabs{display:flex;gap:6px;margin-bottom:10px}.install-tabs button{padding:7px 10px;border:1px solid #3f4a39;background:#151a13;color:#84907f;font:800 9px ui-monospace,monospace;cursor:pointer}.install-tabs button.on{border-color:#caff4b;color:#caff4b}.install-inline pre{min-height:56px;margin:0 0 10px;padding:10px;overflow:auto;background:#090c08;color:#cbd4c5;font:10px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}.install-copy{width:100%;padding:10px;border:0;background:#caff4b;color:#0d100a;font:900 10px ui-monospace,monospace;cursor:pointer}.install-copy:disabled{opacity:.5}
      .terminal{height:680px;display:flex;flex-direction:column;border:1px solid #485440;background:#0d110c;box-shadow:15px 15px 0 #1c2918;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.terminal>header,.terminal>footer{display:flex;justify-content:space-between;padding:14px 17px;color:#82907c;font-size:10px}.terminal>header{border-bottom:1px solid #30382b}.terminal>header i{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#ff9e57;box-shadow:0 0 10px #ff9e57}.session-state{display:flex;justify-content:space-between;padding:11px 17px;background:#141a12;border-bottom:1px solid #30382b;font-size:9px;letter-spacing:.08em}.session-state span{color:#798674}.session-state b{color:#caff4b;text-transform:uppercase}.conversation{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:24px;overflow:auto}.grant-picker{padding:14px 15px;border:1px solid #35533e;background:#0f1c13;animation:arrive .3s ease-out}.grant-picker>header{display:flex;justify-content:space-between;gap:15px;color:#89e8a8;font-size:9px;font-weight:900;letter-spacing:.09em}.grant-picker>header b{color:#caff4b;font-size:10px}.grant-picker>p{margin:8px 0 12px;color:#8fa28f;font-size:10px;line-height:1.5}.grant-options{display:grid;gap:7px}.grant-options button{display:flex;justify-content:space-between;gap:12px;width:100%;padding:10px 11px;border:1px solid #2e4835;background:#111a12;color:#ddeadd;text-align:left;font-family:inherit;cursor:pointer;transition:.16s ease}.grant-options button:hover:not(:disabled){border-color:#79c891;transform:translateX(2px)}.grant-options button.on{border-color:#caff4b;background:#1c2d18;box-shadow:inset 3px 0 #caff4b}.grant-options button:disabled{cursor:default}.grant-options span,.grant-options strong{display:grid;gap:3px}.grant-options b{font-size:11px}.grant-options small{color:#849681;font-size:9px;font-weight:400}.grant-options strong{color:#caff4b;text-align:right;font-size:10px}.grant-picker footer{margin-top:10px;color:#8fa28f;font-size:9px}.grant-picker footer b{color:#caff4b}.composer-demo{align-self:flex-end;width:86%;animation:arrive .28s ease-out}.composer-demo>label{display:block;margin:0 0 7px;color:#6bc7ff;font-size:9px;font-weight:900;letter-spacing:.09em}.composer-demo>div{display:flex;align-items:end;gap:10px;padding:13px;background:#0d1d28;border:1px solid #2d759e;box-shadow:4px 4px 0 #173b50}.composer-demo p{min-height:38px;flex:1;margin:0;color:#d5efff;font-size:12px;line-height:1.6}.composer-demo p i{display:inline-block;width:6px;height:14px;margin-left:2px;vertical-align:-2px;background:#6bc7ff;animation:cursor .72s steps(1) infinite}.composer-demo button{min-width:58px;padding:8px;border:1px solid #2d759e;background:#16384d;color:#6bc7ff;font:900 8px ui-monospace,monospace}.message{max-width:86%;padding:14px 15px;border:1px solid;animation:arrive .3s ease-out}.message span,.action-card header span{display:block;margin-bottom:7px;font-size:9px;font-weight:900;letter-spacing:.09em}.message p,.action-card p{margin:0;font-size:12px;line-height:1.6}.user-message{align-self:flex-end;color:#d5efff;background:#102331;border-color:#2d759e}.user-message.sent{box-shadow:4px 4px 0 #2d759e}.user-message span{color:#6bc7ff}.agent-message{color:#ffe3ce;background:#2b1a10;border-color:#874b25}.agent-message span{color:#ff9e57}.agent-message.complete{border-color:#ff9e57;box-shadow:4px 4px 0 #ff9e57}.action-card{padding:14px 15px;border:1px solid;animation:arrive .3s ease-out}.action-card header{display:flex;align-items:center;justify-content:space-between;gap:15px}.action-card header span{margin:0}.action-card header code,.action-card header b{font-size:10px}.tool-action,.tool-result{color:#e5d9ff;background:#211936;border-color:#6e55a6}.tool-action header span,.tool-result header span,.tool-action code{color:#bc9bff}.tool-result header b{color:#d8c7ff}.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}.result-grid span{display:grid;gap:3px;color:#9e8fbd;font-size:9px}.result-grid b{color:#f4edff;font-size:11px}.policy-action{color:#fff2bd;background:#2b2510;border-color:#9b7f23}.policy-action header span,.policy-action header b{color:#ffd55a}.checks{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;color:#e7d996;font-size:10px}.pay-action{color:#d4ffe5;background:#102a1b;border-color:#2e9360}.pay-action header span,.pay-action header b{color:#75f0a8}.pay-line{display:flex;gap:4px;margin-top:13px}.pay-line span{height:3px;flex:1;background:#75f0a8;animation:pulse 1.1s infinite alternate}.pay-line span:nth-child(2){animation-delay:.2s}.pay-line span:nth-child(3){animation-delay:.4s}@keyframes pulse{from{opacity:.25}to{opacity:1}}@keyframes cursor{0%,48%{opacity:1}49%,100%{opacity:0}}@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.terminal>footer{border-top:1px solid #30382b}.terminal>footer b{color:#caff4b}
      .why{max-width:1260px;margin:auto;padding:135px 38px;border-top:1px solid #30382b}.why>div:first-child{display:grid;grid-template-columns:1fr 1fr}.why-grid{display:grid;grid-template-columns:repeat(3,1fr);margin-top:70px;border-top:1px solid #3b4536}.why-grid article{padding:28px 30px 0 0;margin-right:30px;border-right:1px solid #3b4536}.why-grid article:last-child{border:0}.why-grid article>b{color:#caff4b;font:900 10px ui-monospace,monospace;letter-spacing:.1em}.why-grid h3{font-family:Georgia,serif;font-size:30px;font-weight:400;line-height:1.1}.why-grid p{color:#aab4a4;line-height:1.65}
      .closing{padding:115px max(38px,7vw);display:grid;grid-template-columns:1fr 330px;gap:60px;background:#caff4b;color:#0c1009}.closing .eyebrow{color:#3e4d18}.closing h2{font-size:clamp(58px,8vw,108px)}.closing h2 em{color:#0c1009}.closing>div:last-child{align-self:end;display:grid;gap:10px}.closing a{background:#0c1009;border-color:#0c1009;color:#f4f7ed}.closing a+*{color:#0c1009;border-color:#0c1009}
      @media(max-width:950px){.hero{grid-template-columns:1fr;min-height:0}.grant-radar{max-width:560px}.flow{grid-template-columns:1fr}.flow-copy{max-width:680px}.terminal{height:660px}.why>div:first-child{grid-template-columns:1fr}}
      @media(max-width:700px){.hero,.flow,.why{padding-inline:20px}.hero{padding-top:80px}.hero h1{font-size:62px}.proof{flex-wrap:wrap}.flow{padding-block:95px}.flow h2,.why h2{font-size:46px}.terminal{height:640px}.conversation{padding:15px}.message{max-width:94%}.result-grid,.checks{grid-template-columns:1fr}.why-grid,.closing{grid-template-columns:1fr}.why-grid article{margin:0;padding:25px 0;border-right:0;border-bottom:1px solid #3b4536}.closing{padding:80px 20px}.ticker{justify-content:flex-start}}
    `}</style>
  </main>;
}
