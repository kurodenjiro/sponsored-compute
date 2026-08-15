'use client';

import { useEffect, useMemo, useState } from 'react';
import { SiteNav } from '../../components/site-nav';

type Entry = {
  at: number;
  ok: boolean;
  payer?: string;
  amount: string;
  resource?: string;
  tx?: string;
  error?: string;
  projectId?: string;
  grantId?: string;
  repoSlug?: string;
  repoUrl?: string;
};
type Data = { merchant: string; evil: boolean; payTo: string; price: string; store: string; net: { name: string; chainId: number; explorer: string; xsgd: string }; entries: Entry[] };
const sgd = (amount: string) => (Number(amount) / 1e6).toFixed(2);
const short = (value?: string) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—';
const endpoint = (resource?: string) => { try { const url = new URL(resource ?? ''); return `${url.hostname}${url.pathname}`; } catch { return resource ?? '—'; } };

export default function MerchantPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8000);
      try {
        const response = await fetch('/api/history', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error ?? `Ledger request failed (${response.status})`);
        }
        const next = await response.json() as Data;
        if (active) { setData(next); setError(null); }
      } catch (cause) {
        if (!active) return;
        const message = cause instanceof DOMException && cause.name === 'AbortError'
          ? 'Ledger request timed out. Check the API and Supabase configuration.'
          : cause instanceof Error ? cause.message : 'Unable to load the merchant ledger.';
        setError(message);
      } finally {
        window.clearTimeout(timeout);
      }
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); };
  }, []);

  const summary = useMemo(() => {
    const paid = data?.entries.filter((entry) => entry.ok) ?? [];
    return {
      settled: paid.reduce((total, entry) => total + Number(entry.amount), 0),
      repos: new Set(paid.map((entry) => entry.repoSlug).filter(Boolean)).size,
      grants: new Set(paid.map((entry) => entry.grantId).filter(Boolean)).size,
    };
  }, [data]);

  if (!data) return <main className="loading"><div><b>{error ? 'merchant ledger unavailable' : 'loading merchant ledger…'}</b>{error && <><p>{error}</p><button onClick={() => window.location.reload()}>retry</button></>}</div><style jsx>{` .loading>div{text-align:center;max-width:520px;padding:32px}.loading b{font:400 28px Georgia,serif;color:#f4f6ed}.loading p{margin:14px 0 22px;color:#9ba697;font:12px/1.6 ui-monospace,monospace}.loading button{padding:10px 16px;border:1px solid #caff4b;background:#caff4b;color:#10140f;font:800 10px ui-monospace,monospace;text-transform:uppercase;cursor:pointer}`}</style></main>;

  return <main className="merchant">
    <SiteNav status={<span className={`site-nav-pill ${data.evil ? 'warn' : ''}`}><i /> {data.evil ? 'UNTRUSTED CHALLENGE' : `MERCHANT · CHAIN ${data.net.chainId}`}</span>} />
    <header className="merchant-head"><div><p>MERCHANT CONSOLE · REPO GRANT RECEIVER</p><h1>{data.merchant}<em>.</em></h1><span className={data.evil ? 'bad' : 'live'}>{data.evil ? 'UNTRUSTED CHALLENGE' : 'ALLOWLISTED x402 MERCHANT'}</span></div><aside><span>LIVE LEDGER</span><b>{data.entries.length}</b><small>payment attempts</small></aside></header>

    <section className="stats">
      <div><small>SETTLED FROM GRANTS</small><b>{(summary.settled / 1e6).toFixed(2)} XSGD</b></div>
      <div><small>REPOS / GRANTS SEEN</small><b>{summary.repos} / {summary.grants}</b></div>
      <div><small>PRICE / API CALL</small><b>{sgd(data.price)} XSGD</b></div>
      <div><small>PAY TO</small><code>{short(data.payTo)}</code></div>
    </section>

    {data.evil && <div className="warning">Challenge includes a prompt-injection instruction. The agent checkpoint rejects it before unwrap or signature.</div>}

    <section className="ledger">
      <header><div><p>REPO → GRANT → MERCHANT HISTORY</p><small>Each row is joined with the verified grant-claim registry by payer signer.</small></div><span><i /> {data.store === 'memory' ? 'INSTANCE MEMORY' : 'PERSISTED LEDGER'}</span></header>
      {data.entries.length === 0 ? <div className="empty"><b>No payment yet.</b><p>The first valid x402 request from a claimed repo grant will appear here—without placeholder rows.</p></div> : <div className="table">
        <div className="table-head"><span>STATUS / TIME</span><span>REPOSITORY + GRANT</span><span>RESOURCE</span><span>PAYER</span><span>AMOUNT</span><span>RECEIPT</span></div>
        {data.entries.map((entry, index) => <article key={`${entry.at}-${index}`} className={entry.ok ? 'ok' : 'failed'}>
          <div className="status"><b>{entry.ok ? 'SETTLED' : 'REJECTED'}</b><time>{new Date(entry.at).toLocaleString()}</time></div>
          <div className="repo"><strong>{entry.repoSlug ?? 'unmatched repo'}</strong>{entry.grantId ? <small>grant #{entry.grantId} · project {short(entry.projectId)}</small> : <small>no matching claim in registry</small>}{entry.repoUrl && <a href={entry.repoUrl} target="_blank" rel="noreferrer">open repository ↗</a>}</div>
          <code className="resource">{endpoint(entry.resource)}</code>
          <code>{short(entry.payer)}</code>
          <b className="amount">{sgd(entry.amount)} XSGD</b>
          {entry.tx ? <a className="receipt" href={entry.tx} target="_blank" rel="noreferrer">Snowtrace ↗</a> : <em>{entry.error ?? '—'}</em>}
        </article>)}
      </div>}
    </section>

    <style jsx>{`
      :global(body){margin:0;background:#090b09;color:#f4f6ed;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.merchant,.loading{min-height:100vh;padding:0 4.5vw 90px;background:radial-gradient(circle at 88% 8%,#23361f 0,transparent 29%),#0b0e0a}.merchant-head{padding:76px 0 48px;display:flex;align-items:end;justify-content:space-between;gap:40px}.merchant-head p,.stats small,.ledger header p{font:800 10px ui-monospace,monospace;letter-spacing:.12em}.merchant-head p,.merchant-head em,.live{color:#caff4b}.merchant-head h1{margin:17px 0 27px;font-size:clamp(62px,10vw,128px);line-height:.8;letter-spacing:-.09em}.merchant-head em{font-family:Georgia,serif;font-weight:400}.live,.bad{font:800 10px ui-monospace,monospace;letter-spacing:.08em}.bad{color:#ff8379}.merchant-head aside{width:180px;padding:20px;border:1px solid #53614b;background:#121711;box-shadow:8px 8px #caff4b;display:grid;gap:6px}.merchant-head aside span,.merchant-head aside small{color:#889482;font:9px ui-monospace,monospace}.merchant-head aside b{color:#caff4b;font:800 44px/1 Georgia,serif}
      .stats{display:grid;grid-template-columns:repeat(4,1fr);border-block:1px solid #394333}.stats div{min-width:0;padding:23px}.stats div:first-child{padding-left:0}.stats div+div{border-left:1px solid #394333}.stats small{display:block;margin-bottom:11px;color:#7d8977}.stats b{color:#caff4b;font-size:23px}.stats code{color:#dce7d5;font:12px ui-monospace,monospace}.warning{margin-top:22px;padding:16px;border-left:3px solid #ff8379;background:#291715;color:#ffd7d2;line-height:1.5}
      .ledger{margin-top:58px;border:1px solid #414d3b;background:#10140f}.ledger>header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:21px;border-bottom:1px solid #414d3b}.ledger header p{margin:0 0 6px;color:#caff4b}.ledger header small{color:#83907c}.ledger>header>span{color:#879481;font:9px ui-monospace,monospace}.ledger>header i{display:inline-block;width:6px;height:6px;margin-right:5px;border-radius:50%;background:#caff4b}.empty{padding:42px 21px}.empty b{font-family:Georgia,serif;font-size:26px;font-weight:400}.empty p{color:#909c8a}.table-head,.table article{display:grid;grid-template-columns:135px minmax(180px,1.25fr) minmax(170px,1fr) 100px 105px 100px;gap:15px;align-items:center}.table-head{padding:11px 20px;background:#161c14;color:#697563;font:8px ui-monospace,monospace;letter-spacing:.1em}.table article{position:relative;padding:17px 20px;border-top:1px solid #293226}.table article::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#75f0a8}.table article.failed::before{background:#ff8379}.status,.repo{display:grid;gap:5px}.status b{color:#75f0a8;font:900 9px ui-monospace,monospace}.failed .status b{color:#ff8379}.status time,.repo small{color:#788573;font:9px/1.4 ui-monospace,monospace}.repo strong{font-size:13px}.repo a,.receipt{color:#caff4b;text-decoration:none;font:9px ui-monospace,monospace}.table article>code{overflow:hidden;color:#9ba697;font:10px ui-monospace,monospace;text-overflow:ellipsis}.resource{color:#cdd8c7!important}.amount{font-size:12px;white-space:nowrap}.table em{overflow:hidden;color:#ff8379;font:9px ui-monospace,monospace;text-overflow:ellipsis}
      .loading{display:grid;place-items:center;color:#caff4b;font:12px ui-monospace,monospace}@media(max-width:1000px){.stats{grid-template-columns:repeat(2,1fr)}.stats div:nth-child(3){border-left:0;border-top:1px solid #394333}.stats div:first-child,.stats div:nth-child(3){padding-left:0}.table-head{display:none}.table article{grid-template-columns:120px 1fr 1fr}.resource{grid-column:3}.amount{grid-column:2}.receipt,.table em{grid-column:3}.table article>code:not(.resource){grid-column:1}}
      @media(max-width:650px){.merchant{padding-inline:20px}.merchant-head{align-items:start;flex-direction:column}.merchant-head aside{display:none}.stats{grid-template-columns:1fr}.stats div{padding-left:0}.stats div+div{border-left:0;border-top:1px solid #394333}.ledger>header{align-items:start;flex-direction:column}.table article{grid-template-columns:1fr}.resource,.amount,.receipt,.table em,.table article>code:not(.resource){grid-column:1}}
    `}</style>
  </main>;
}
