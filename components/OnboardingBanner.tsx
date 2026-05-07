'use client';

// New-user banner — rendered by the dashboard layout when the server has
// already determined that:
//   1. the visitor has 0 captured memories, AND
//   2. their account is less than 24h old.
//
// Client component because we want a localStorage-backed dismiss that
// persists across page navigations without a round-trip. The server has
// already done the gating, so this component just renders + handles the
// "Not now" button and the link to /onboarding.

import { useEffect, useState } from 'react';
import Link from 'next/link';

const DISMISS_KEY = 'spine_onboarding_banner_dismissed';

export function OnboardingBanner() {
  const [hidden, setHidden] = useState(true);

  // Reveal only on the client, after we've checked localStorage. Avoids a
  // flash-then-dismiss for users who already clicked "Not now."
  useEffect(() => {
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {
      // localStorage blocked (private mode etc.) — show the banner anyway.
    }
    setHidden(false);
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore — UX still works without persistence
    }
    setHidden(true);
  };

  if (hidden) return null;

  return (
    <div className="px-6 md:px-10 pt-6">
      <div
        className="max-w-5xl mx-auto rounded-xl border border-amber/25 bg-amber/[0.04] px-5 py-5 md:px-7 md:py-6 flex flex-col md:flex-row md:items-center gap-5"
        role="status"
        aria-live="polite"
      >
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber mb-2">
            New here? · 5-minute tour
          </p>
          <p className="font-serif text-xl md:text-2xl text-cream leading-tight mb-1.5">
            Your archive is empty. Let&apos;s give it something to remember.
          </p>
          <p className="text-cream/55 text-[13px] leading-relaxed">
            Three steps: install the MCP server, wire it into Claude, watch
            your first memory arrive. About five minutes.
          </p>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <Link
            href="/onboarding"
            className="group inline-flex items-center gap-2 px-5 py-2.5 bg-amber text-night font-mono text-[11px] uppercase tracking-widest hover:bg-cream transition-colors duration-300 rounded"
          >
            Start the tour
            <span className="transition-transform duration-300 group-hover:translate-x-1">
              →
            </span>
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-cream/65 transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
