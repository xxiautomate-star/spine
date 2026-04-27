'use client';

// Upgrade overlay — shown when a free user crosses 80% of their cap (warning)
// and as a hard block at 100% of cap with a contextual message about what
// just happened. Replaces the old behaviour where the only signal was a 402
// response from /api/capture, which the user never saw.
//
// Mounted globally inside the dashboard layout so any page can trigger it
// without prop-drilling. Three trigger paths:
//
//   1. Passive: useUsageWatcher() polls /api/usage every 30s. At ≥80% it
//      shows the soft warning banner. At 100% it auto-opens the modal.
//   2. Imperative: any client component can call openUpgrade() (exposed via
//      window.__spineUpgrade) — used by API error handlers when they see
//      the 402 plan_upgrade_required code.
//   3. Manual: any nav link can pass ?upgrade=1 in the URL.
//
// The overlay is intentionally not a router redirect — we never want to
// kick a user off whatever they're doing. Soft modal, dismissable.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

type Usage = {
  count: number;
  plan: 'free' | 'pro' | 'team';
  limit: number | null;
  pctUsed: number;
};

const POLL_MS = 30_000;
const SOFT_THRESHOLD = 80;
const HARD_THRESHOLD = 100;

declare global {
  interface Window {
    __spineUpgrade?: { open: () => void };
  }
}

export function UpgradeOverlay() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);
  const dismissedHardRef = useRef(false); // session-level dismissal of hard modal

  // Imperative open exposed globally so non-React error handlers (the MCP
  // sidecar response, fetch interceptors) can trigger the overlay without
  // wiring through context.
  useEffect(() => {
    window.__spineUpgrade = { open: () => setOpen(true) };
    return () => {
      delete window.__spineUpgrade;
    };
  }, []);

  // URL trigger: /dashboard/anything?upgrade=1 opens the modal.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('upgrade') === '1') setOpen(true);
  }, []);

  // Poll usage. Auto-open the hard modal exactly once per session when we
  // first observe pctUsed >= 100. Don't keep re-opening if the user
  // dismisses — that would feel hostile.
  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch('/api/usage', { credentials: 'include' });
        if (!res.ok) return;
        const u = (await res.json()) as Usage;
        if (cancelled) return;
        setUsage(u);
        if (u.pctUsed >= HARD_THRESHOLD && !dismissedHardRef.current) {
          setOpen(true);
        }
      } catch {
        /* offline */
      }
    }

    void fetchOnce();
    const id = window.setInterval(() => void fetchOnce(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (usage && usage.pctUsed >= HARD_THRESHOLD) {
      dismissedHardRef.current = true;
    }
  }, [usage]);

  // Pro / Team users never see this. Stop early.
  if (usage && usage.plan !== 'free') return null;

  const pct = usage?.pctUsed ?? 0;
  const showBanner = pct >= SOFT_THRESHOLD && pct < HARD_THRESHOLD;
  const isHard = pct >= HARD_THRESHOLD;

  return (
    <>
      {/* Soft warning banner — fixed top, never over content. Dismiss by
          clicking the X; reappears on next page load if still over 80%. */}
      {showBanner && !open && <SoftBanner usage={usage} onUpgrade={() => setOpen(true)} />}

      {open && usage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] bg-night/85 backdrop-blur-md flex items-center justify-center px-6 animate-[fadeIn_.3s_ease-out]"
          onClick={close}
        >
          <div
            className="max-w-lg w-full bg-night border border-amber/30 p-8 md:p-10 rounded-xl shadow-[0_30px_80px_rgba(232,154,60,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-5">
              {isHard ? 'Free archive full' : 'Almost full'}
            </p>
            <h2 className="font-serif text-3xl md:text-4xl text-cream leading-[1.1] mb-5">
              {isHard
                ? 'Your archive has outgrown the free tier.'
                : 'You’re close to the edge.'}
            </h2>
            <p className="text-cream/65 leading-relaxed mb-7">
              {isHard ? (
                <>
                  You&apos;ve captured <span className="text-amber font-medium">{usage.count}</span> of{' '}
                  <span className="text-cream/85">{usage.limit}</span> memories. New captures will be
                  rejected until you upgrade — your existing archive is untouched and will keep
                  serving recalls.
                </>
              ) : (
                <>
                  <span className="text-amber font-medium">{usage.count}</span> of{' '}
                  <span className="text-cream/85">{usage.limit}</span> memories used. Upgrade now to
                  keep capturing without interruption.
                </>
              )}
            </p>

            <div className="border border-cream/[0.08] rounded-lg p-5 mb-6 bg-cream/[0.02]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
                Pro · $19/mo
              </p>
              <ul className="space-y-1.5 text-[14px] text-cream/65">
                {[
                  'Unlimited memories',
                  'Hybrid vector + BM25 retrieval',
                  'Cross-encoder rerank',
                  'Conflict detection + decay recovery',
                  'Decisions extraction',
                  'Weekly retention digest',
                ].map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span className="text-amber/65 select-none">—</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Link
                href="/dashboard/billing?plan=pro"
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-amber text-night font-mono text-[12px] uppercase tracking-widest hover:bg-cream transition-colors"
              >
                Upgrade → $19/mo
              </Link>
              <button
                onClick={close}
                className="font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-cream/70 transition-colors py-2"
              >
                {isHard ? 'Not now' : 'Dismiss'}
              </button>
            </div>

            <p className="font-mono text-[10px] text-cream/25 mt-6 leading-relaxed">
              You can cancel any time. 14-day refund on first charge. Existing memories are never
              deleted by a downgrade — they stay in your archive, just dormant past the cap.
            </p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
    </>
  );
}

function SoftBanner({ usage, onUpgrade }: { usage: Usage | null; onUpgrade: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || !usage) return null;
  return (
    <div className="fixed top-[68px] inset-x-0 z-40 px-6 md:px-10 py-2.5 bg-amber/[0.08] border-b border-amber/25 backdrop-blur-md flex items-center gap-4">
      <p className="font-mono text-[11px] text-cream/75 flex-1 truncate">
        <span className="text-amber font-medium">{usage.pctUsed}%</span> of your free archive used
        · {usage.count} of {usage.limit} memories
      </p>
      <button
        onClick={onUpgrade}
        className="font-mono text-[10px] uppercase tracking-widest text-amber hover:text-cream transition-colors"
      >
        Upgrade
      </button>
      <button
        onClick={() => setHidden(true)}
        className="text-cream/30 hover:text-cream/60 transition-colors text-[14px] leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
