'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

const LINKS: { href: string; label: string; match?: string }[] = [
  { href: '/#flow', label: 'How it works' },
  { href: '/merchant', label: 'Merchant', match: '/merchant' },
  { href: '/sponsor', label: 'Sponsor', match: '/sponsor' },
];

/** Shared across all three pages so the header stays one design, not three. */
export function SiteNav({ status }: { status?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A route change already closed the panel by navigating away from under it,
  // but state would otherwise survive a client-side nav back to the same page.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // The toggle button only renders below 850px; if the viewport grows past
    // that while open (rotate, resize), close it — no dangling overlay.
    const onResize = () => { if (window.innerWidth > 850) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [open]);

  const statusPill = status ?? <span className="site-nav-pill"><i /> FUJI · LIVE</span>;

  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav-brand">sponsored<span>compute</span></Link>
      <div className="site-nav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={l.match && pathname === l.match ? 'on' : ''}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="site-nav-status">{statusPill}</div>
      <button
        type="button"
        className={`site-nav-toggle ${open ? 'open' : ''}`}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span /><span /><span />
      </button>
      {open && (
        <div className="site-nav-overlay" onClick={() => setOpen(false)}>
          <div className="site-nav-panel" onClick={(e) => e.stopPropagation()}>
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={l.match && pathname === l.match ? 'on' : ''} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
            <div className="site-nav-panel-status">{statusPill}</div>
          </div>
        </div>
      )}
    </nav>
  );
}
