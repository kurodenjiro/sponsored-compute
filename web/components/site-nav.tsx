'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const LINKS: { href: string; label: string; match?: string }[] = [
  { href: '/#flow', label: 'How it works' },
  { href: '/merchant', label: 'Merchant', match: '/merchant' },
  { href: '/sponsor', label: 'Sponsor', match: '/sponsor' },
];

/** Shared across all three pages so the header stays one design, not three. */
export function SiteNav({ status }: { status?: ReactNode }) {
  const pathname = usePathname();
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
      <div className="site-nav-status">
        {status ?? <span className="site-nav-pill"><i /> FUJI · LIVE</span>}
      </div>
    </nav>
  );
}
