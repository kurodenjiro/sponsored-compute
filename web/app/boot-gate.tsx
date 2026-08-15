'use client';

import { useEffect, useState, type ReactNode } from 'react';

export function BootGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reveal = async () => {
      try { await document.fonts?.ready; } catch { /* the page can render with fallback fonts */ }
      window.requestAnimationFrame(() => { if (!cancelled) setReady(true); });
    };
    if (document.readyState === 'complete') void reveal();
    else window.addEventListener('load', reveal, { once: true });
    const fallback = window.setTimeout(() => setReady(true), 2_500);
    return () => { cancelled = true; window.clearTimeout(fallback); window.removeEventListener('load', reveal); };
  }, []);

  return <><div className={ready ? 'app-content app-content-ready' : 'app-content'}>{children}</div>{!ready && <div className="app-loader" role="status" aria-label="Loading Sponsored Compute"><div><b>sponsored<span>compute</span></b><i /><small>loading verified compute</small></div></div>}</>;
}
