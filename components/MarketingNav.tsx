'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS: Array<{ href: string; label: string; matches: (p: string) => boolean }> = [
  { href: '/features', label: 'Features', matches: (p) => p === '/features' },
  { href: '/pricing', label: 'Pricing', matches: (p) => p === '/pricing' },
  { href: '/proof', label: 'Proof', matches: (p) => p.startsWith('/proof') },
  { href: '/docs/mcp', label: 'Docs', matches: (p) => p.startsWith('/docs') },
];

export function MarketingNav() {
  const pathname = usePathname() || '/';

  return (
    <nav
      className="sticky top-0 inset-x-0 z-40 px-6 md:px-10 py-5 flex items-center justify-between"
      style={{
        background: 'rgba(255, 253, 247, 0.78)',
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
        borderBottom: '1px solid var(--s-vein)',
      }}
    >
      <Link href="/" className="flex items-center gap-3">
        <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
          <defs>
            <linearGradient id="spineNavGoldShared" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#e8c769" />
              <stop offset="55%" stopColor="#b8924a" />
              <stop offset="100%" stopColor="#7a5f2a" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="14.5" stroke="url(#spineNavGoldShared)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
          <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spineNavGoldShared)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
        </svg>
        <span className="font-serif text-[1.4rem] tracking-wide" style={{ color: 'var(--s-ink)' }}>
          Spine
        </span>
      </Link>
      <div className="flex items-center gap-4 md:gap-6">
        {NAV_ITEMS.map((item) => {
          const active = item.matches(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="font-mono text-[10px] uppercase tracking-[0.2em] hidden md:block transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
              style={{
                color: active ? 'var(--s-gold-deep)' : 'var(--s-ink-faint)',
                fontWeight: active ? 600 : 400,
              }}
            >
              {item.label}
            </Link>
          );
        })}
        <Link
          href="/login"
          className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-300 hover:[color:var(--s-ink)]"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          Sign in
        </Link>
        <Link
          href="/login?signup=1"
          className="font-mono text-[10px] uppercase tracking-[0.2em] px-4 py-2 transition-colors duration-300 rounded-md"
          style={{
            background: 'linear-gradient(180deg, #fdfaf2 0%, #f1e6c8 100%)',
            color: 'var(--s-gold-deep)',
            border: '1px solid var(--s-vein-strong)',
            fontWeight: 600,
            boxShadow: '0 1px 2px rgba(60,45,20,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
          }}
        >
          Install free →
        </Link>
      </div>
    </nav>
  );
}
