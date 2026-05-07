import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Not in the archive — Spine',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--s-bg)', color: 'var(--s-ink)' }}
    >
      <div className="max-w-lg text-center">
        <p
          className="font-mono text-[11px] uppercase tracking-[0.32em] mb-6"
          style={{ color: 'var(--s-gold-deep)' }}
        >
          404 · Not in the archive
        </p>
        <h1 className="font-serif text-5xl md:text-6xl leading-[0.95] mb-6">
          Nothing here to remember.
        </h1>
        <p
          className="text-base leading-relaxed mb-10"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          That URL doesn&apos;t match anything Spine has on file. The page may
          have been renamed, or the link arrived a little broken.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-md font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-300"
            style={{ background: 'var(--s-ink)', color: 'var(--s-bg-cool)' }}
          >
            Back to the home page
          </Link>
          <Link
            href="/docs/mcp"
            className="inline-block px-6 py-3 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors duration-300"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            Read the install guide →
          </Link>
        </div>
      </div>
    </main>
  );
}
