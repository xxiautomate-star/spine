'use client';

// Mobile-first dashboard nav. Below 768px the eight links collapse into a
// hamburger that opens a full-width slide-down panel. Desktop renders the
// existing horizontal nav so screen-real-estate isn't wasted.
//
// The auth-bound email + signout form are rendered by the parent server
// component (it has user.email; the client doesn't need it for the menu
// itself). They get passed through as the `tail` slot.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/timeline',             label: 'Timeline' },
  { href: '/sessions',             label: 'Sessions' },
  { href: '/dashboard/memories',   label: 'Archive' },
  { href: '/dashboard/recall',     label: 'Recall' },
  { href: '/dashboard/decisions',  label: 'Decisions' },
  { href: '/graph',                label: 'Constellation' },
  { href: '/dashboard/keys',       label: 'Keys' },
  { href: '/dashboard/hygiene',    label: 'Hygiene' },
  { href: '/dashboard/health',     label: 'Health' },
  { href: '/dashboard/audit',      label: 'Audit' },
  { href: '/dashboard/billing',    label: 'Billing' },
];

export function DashboardNav({ tail }: { tail: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the menu on route change so a tap on a link doesn't leave the
  // menu open over the page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the menu is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      {/* Desktop: horizontal nav with all links. Hidden under 768px. */}
      <nav className="hidden md:flex items-center gap-5 font-mono text-[11px] uppercase tracking-widest">
        {LINKS.slice(0, 7).map((l) => (
          <Link key={l.href} href={l.href} className="text-cream/60 hover:text-cream">
            {l.label}
          </Link>
        ))}
        {/* The remaining links collapse under a "More" pop-down on
            tighter desktops too, so we never wrap to two rows. */}
        <DesktopMore links={LINKS.slice(7)} />
        {tail}
      </nav>

      {/* Mobile: hamburger toggle. Visible under 768px. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="md:hidden flex flex-col items-end gap-1.5 p-2 -mr-2"
      >
        <span
          className={`block w-5 h-px bg-cream/70 transition-transform duration-300 ${
            open ? 'translate-y-[7px] rotate-45' : ''
          }`}
        />
        <span
          className={`block w-5 h-px bg-cream/70 transition-opacity duration-300 ${
            open ? 'opacity-0' : ''
          }`}
        />
        <span
          className={`block w-5 h-px bg-cream/70 transition-transform duration-300 ${
            open ? '-translate-y-[7px] -rotate-45' : ''
          }`}
        />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-x-0 top-[68px] bottom-0 z-40 bg-night/95 backdrop-blur-md border-t border-cream/[0.05] overflow-y-auto">
          <ul className="flex flex-col py-2">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname?.startsWith(l.href + '/');
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={`block px-6 py-4 font-serif text-2xl border-b border-cream/[0.05] transition-colors ${
                      active ? 'text-amber' : 'text-cream/85 hover:text-cream'
                    }`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
            <li className="px-6 py-6 border-b border-cream/[0.05]">{tail}</li>
          </ul>
        </div>
      )}
    </>
  );
}

// Desktop "More" dropdown so 10 links don't wrap to two rows on a 1024px
// laptop. Click to open, click outside to close.
function DesktopMore({ links }: { links: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onClick() {
      setOpen(false);
    }
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-cream/60 hover:text-cream font-mono text-[11px] uppercase tracking-widest"
      >
        More <span className="ml-1 text-cream/30">⌄</span>
      </button>
      {open && (
        <div className="absolute right-0 top-7 min-w-[180px] bg-night/95 backdrop-blur-md border border-cream/10 py-2 rounded-lg shadow-2xl">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-cream/70 hover:text-amber hover:bg-cream/[0.04]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
