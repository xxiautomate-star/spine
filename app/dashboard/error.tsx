'use client';

import { useEffect } from 'react';
import Link from 'next/link';

// Dashboard-scoped error boundary. Inherits dark palette (bg-night/text-cream)
// to match the rest of /dashboard rather than the cream marketing theme.
// Caught here: any thrown error inside /dashboard/* — most often a Supabase
// timeout or a missing-RLS row. The data is fine; just couldn't be loaded.

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[spine/dashboard] route error', error);
    }
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-night text-cream">
      <div className="max-w-md text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] mb-5 text-amber">
          The archive paused
        </p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[0.95] mb-5">
          Couldn&apos;t reach your memories.
        </h1>
        <p className="text-cream/55 leading-relaxed mb-6 text-sm">
          Your data is intact — Spine couldn&apos;t deliver it to this tab.
          Most often a brief network blip or a slow Supabase round-trip.
          Try once more.
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] tracking-wider mb-7 text-cream/30">
            ref · {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            type="button"
            onClick={reset}
            className="inline-block px-6 py-3 rounded-md font-mono text-[11px] uppercase tracking-[0.22em] bg-cream text-night hover:bg-amber transition-colors duration-300"
          >
            Try again
          </button>
          <Link
            href="/dashboard/memories"
            className="inline-block px-6 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 hover:text-amber transition-colors duration-300"
          >
            Back to archive →
          </Link>
        </div>
      </div>
    </main>
  );
}
