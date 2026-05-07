'use client';

import { useEffect } from 'react';
import Link from 'next/link';

// Root error boundary — catches anything thrown from a Server Component or
// Client Component during render. Replaces the default Next.js red error
// overlay with a Spine-native page so users never see a raw stack trace.
//
// `digest` is the redacted error key Next.js exposes — safe to surface.
// The full error.message stays server-side. Recoverable failures (e.g. a
// transient Supabase fetch) get a "Try again" button that calls reset().

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[spine] route error', error);
    }
  }, [error]);

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--s-bg)', color: 'var(--s-ink)' }}
    >
      <div className="max-w-lg text-center">
        <p
          className="font-mono text-[11px] uppercase tracking-[0.32em] mb-6"
          style={{ color: 'var(--s-amber-warm)' }}
        >
          The archive paused
        </p>
        <h1 className="font-serif text-5xl md:text-6xl leading-[0.95] mb-6">
          Something quiet broke.
        </h1>
        <p
          className="text-base leading-relaxed mb-8"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          The page didn&apos;t finish rendering. The server kept your data —
          this is purely a delivery issue. Try once more, or come back to the
          home page and pick a different door.
        </p>
        {error.digest && (
          <p
            className="font-mono text-[10px] tracking-wider mb-8"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            ref · {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <button
            type="button"
            onClick={reset}
            className="inline-block px-6 py-3 rounded-md font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-300"
            style={{ background: 'var(--s-ink)', color: 'var(--s-bg-cool)' }}
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-block px-6 py-3 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-300"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            Home →
          </Link>
        </div>
      </div>
    </main>
  );
}
