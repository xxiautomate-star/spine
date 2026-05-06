import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer
      className="relative px-6 md:px-16 py-14"
      style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
              <defs>
                <linearGradient id="spineFooterGoldShared" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#e8c769" />
                  <stop offset="55%" stopColor="#b8924a" />
                  <stop offset="100%" stopColor="#7a5f2a" />
                </linearGradient>
              </defs>
              <circle cx="16" cy="16" r="14.5" stroke="url(#spineFooterGoldShared)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
              <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spineFooterGoldShared)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            </svg>
            <p className="font-serif text-2xl" style={{ color: 'var(--s-ink)' }}>Spine</p>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--s-ink-faint)' }}>
            A memory layer for your AI
          </p>
        </div>
        <div className="flex flex-col md:items-end gap-2">
          <div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase tracking-widest">
            {[
              ['/features', 'Features'],
              ['/pricing', 'Pricing'],
              ['/proof', 'Proof'],
              ['/docs/mcp', 'Docs'],
              ['/docs/team-policies', 'Teams'],
              ['/privacy', 'Privacy'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
                style={{ color: 'var(--s-ink-faint)' }}
              >
                {label}
              </Link>
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--s-ink-ghost)' }}>
            © {new Date().getFullYear()} · XXIautomate · Built in Sydney
          </p>
        </div>
      </div>
    </footer>
  );
}
