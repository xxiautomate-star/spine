import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import type { SpineStats } from '@/app/api/spine-stats/route';

export const metadata: Metadata = {
  title: 'Spine — live stats',
  description: 'Real production metrics from the Spine memory layer. Not mocked.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 60;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

async function fetchStats(): Promise<SpineStats | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const res = await fetch(`${proto}://${host}/api/spine-stats`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as SpineStats;
  } catch {
    return null;
  }
}

export default async function SpineStatsPage() {
  const stats = await fetchStats();

  const tiles: Array<{ label: string; value: string; sub?: string }> =
    stats === null
      ? [
          { label: 'Total memories ingested', value: '—', sub: 'Stats endpoint unreachable' },
          { label: 'Cross-session recalls · 7d', value: '—' },
          { label: 'Avg retrieval latency', value: '—' },
          { label: 'Memories per dollar of spend', value: '—' },
        ]
      : [
          {
            label: 'Total memories ingested',
            value: fmt(stats.total_memories),
            sub: 'Append-only · never summarised',
          },
          {
            label: 'Cross-session recalls · 7d',
            value: fmt(stats.cross_session_recalls_7d),
            sub: `${fmt(stats.total_recalls_7d)} total recalls this week`,
          },
          {
            label: 'Avg retrieval latency',
            value: stats.avg_latency_ms === null ? '—' : `${stats.avg_latency_ms}ms`,
            sub: 'End-to-end · Supabase pgvector + BM25',
          },
          {
            label: 'Memories per dollar of spend',
            value:
              stats.memories_per_dollar === null
                ? '—'
                : fmt(stats.memories_per_dollar),
            sub:
              stats.total_spend_usd > 0
                ? `$${stats.total_spend_usd.toFixed(4)} total rerank + embed spend`
                : 'Rerank + embed spend',
          },
        ];

  return (
    <main className="relative bg-night text-cream min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 px-5 md:px-10 py-4 md:py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/[0.05]">
        <Link href="/spine" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-lg md:text-xl tracking-wide">Spine</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hidden sm:inline">
            · labs
          </span>
        </Link>
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/spine" className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300">
            Overview
          </Link>
          <Link href="/spine/log" className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300">
            Changelog
          </Link>
          <Link
            href="/spine#waitlist"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 bg-amber text-night hover:bg-cream transition-colors duration-300"
          >
            Get a seat →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 md:pt-32 pb-10 md:pb-14 px-5 md:px-10">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Live stats · production · refreshed every minute
          </p>
          <h1 className="font-serif text-[2.2rem] leading-[1.02] sm:text-[2.8rem] md:text-[4rem] md:leading-[1.02] text-cream tracking-tight max-w-4xl">
            Real numbers. From the real memory layer. Not mocked.
          </h1>
          <p className="mt-6 text-cream/55 max-w-2xl text-[15px] md:text-base leading-relaxed">
            Every figure here is queried live from the production Supabase. If
            a number is small, that&rsquo;s because it&rsquo;s honest. The
            product is days old.
          </p>
          {stats?.updated_at && (
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-cream/30">
              Updated{' '}
              {new Date(stats.updated_at).toLocaleString('en-AU', {
                hour12: false,
                timeZoneName: 'short',
              })}
            </p>
          )}
        </div>
      </section>

      {/* Tiles */}
      <section className="px-5 md:px-10 pb-16 md:pb-24">
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {tiles.map((t, i) => (
            <div
              key={t.label}
              className="rise p-6 md:p-8 border border-cream/[0.08] bg-cream/[0.015]"
              style={{ animationDelay: `${0.1 + i * 0.07}s` }}
            >
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-4">
                {t.label}
              </p>
              <p className="font-serif text-5xl md:text-6xl text-cream tracking-tight leading-none">
                {t.value}
              </p>
              {t.sub && (
                <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-cream/35">
                  {t.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Honest note */}
      <section className="px-5 md:px-10 pb-24 md:pb-32">
        <div className="max-w-3xl mx-auto border-l-2 border-amber/45 pl-5 md:pl-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-4">
            § Honesty clause
          </p>
          <p className="font-serif italic text-xl md:text-2xl text-cream/85 leading-snug">
            &ldquo;Vanity metrics are a failure of confidence. The numbers
            above are what actually shipped today. The only direction they move
            is up.&rdquo;
          </p>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-cream/35">
            Source: <Link href="/api/spine-stats" className="underline decoration-cream/30 hover:decoration-amber">/api/spine-stats</Link> · open-JSON · cache: 60s
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl text-cream leading-tight">
              Want your own compounding loop?
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              Waitlist is open · rolling access
            </p>
          </div>
          <Link
            href="/spine#waitlist"
            className="group inline-flex items-center justify-center gap-3 px-6 py-3 bg-amber text-night hover:bg-cream transition-colors duration-500 self-start md:self-auto"
          >
            <span className="font-serif text-lg">Request a seat</span>
            <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono">→</span>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-5 md:px-10 py-10 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/spine" className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hover:text-amber">
            ← back to Spine
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/20">
            © {new Date().getFullYear()} · XXIautomate
          </p>
        </div>
      </footer>
    </main>
  );
}
