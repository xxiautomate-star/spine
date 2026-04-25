import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import type { BenchSummary, BenchRun } from '@/app/api/spine-bench/route';
import { BenchLatencyChart } from '@/components/BenchLatencyChart';

export const metadata: Metadata = {
  title: 'Spine — proof of a million memories',
  description:
    'Needle-in-haystack benchmark. Real Supabase, real embeddings, real scale. We seeded the corpus, hid identifiable memories, and asked Spine to find them.',
};

export const dynamic = 'force-dynamic';
export const revalidate = 60;

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

async function fetchBench(): Promise<BenchSummary | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const res = await fetch(`${proto}://${host}/api/spine-bench`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as BenchSummary;
  } catch {
    return null;
  }
}

export default async function SpineProofPage() {
  const bench = await fetchBench();
  const latest: BenchRun | null = bench?.latest ?? null;
  const byScale = bench?.by_scale ?? [];

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
          <Link href="/spine" className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors">
            Overview
          </Link>
          <Link href="/spine/stats" className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors">
            Stats
          </Link>
          <Link href="/spine/log" className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors hidden sm:inline">
            Changelog
          </Link>
          <Link href="/spine#waitlist" className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 bg-amber text-night hover:bg-cream transition-colors">
            Get a seat →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 md:pt-36 pb-16 md:pb-20 px-5 md:px-10">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Proof · scale benchmark · needle-in-haystack
          </p>
          <h1 className="font-serif text-[2.4rem] leading-[1.02] sm:text-[3.2rem] md:text-[4.8rem] md:leading-[0.98] text-cream tracking-tight max-w-5xl">
            {latest ? (
              <>
                {fmt(latest.scale)} memories.{' '}
                <em className="italic text-amber">{latest.p99_latency_ms}ms p99.</em>
                <br />
                {(latest.recall_accuracy * 100).toFixed(1)}% of needles found.
              </>
            ) : (
              <>
                Proof of a <em className="italic text-amber">million</em> memories.
                <br />
                Coming up next run.
              </>
            )}
          </h1>

          <div className="mt-10 md:mt-12 max-w-3xl">
            <blockquote className="border-l-2 border-amber/50 pl-5 md:pl-7 py-1 text-lg md:text-xl text-cream/85 font-serif italic leading-relaxed">
              We seeded a real Supabase with synthetic memories at the scale on
              the tin. Then we hid uniquely identifiable needles in that
              haystack and asked Spine to find them. Everything below is the
              actual benchmark output, written by the bench script, refreshed
              every minute.
            </blockquote>
          </div>
        </div>
      </section>

      {/* Latest run headline */}
      {latest && (
        <section className="px-5 md:px-10 pb-16">
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {[
              { label: 'Memories indexed', value: fmt(latest.scale), sub: 'real rows, real vectors' },
              {
                label: 'p99 recall latency',
                value: `${latest.p99_latency_ms}ms`,
                sub: `p95 ${latest.p95_latency_ms}ms · p50 ${latest.p50_latency_ms}ms`,
              },
              {
                label: 'Needles found',
                value: `${latest.needles_found}/${latest.query_count}`,
                sub: `${(latest.recall_accuracy * 100).toFixed(1)}% · top-${latest.top_k} retrieval`,
              },
              {
                label: 'Avg / max latency',
                value: `${latest.avg_latency_ms}ms`,
                sub: `max ${latest.max_latency_ms}ms · ${latest.embed_model ?? 'text-embedding-3-small'}`,
              },
            ].map((t, i) => (
              <div
                key={t.label}
                className="rise p-5 md:p-7 border border-cream/[0.08] bg-cream/[0.015]"
                style={{ animationDelay: `${0.1 + i * 0.06}s` }}
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
                  {t.label}
                </p>
                <p className="font-serif text-3xl md:text-5xl text-cream tracking-tight leading-none">
                  {t.value}
                </p>
                <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-cream/35">
                  {t.sub}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Latency vs scale chart */}
      <section className="px-5 md:px-10 pb-16 md:pb-24">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Latency vs. scale · log-x · one point per bench run
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-8">
            The shape matters more than the point.
          </h2>
          <p className="text-cream/55 max-w-2xl leading-relaxed mb-10 text-[15px] md:text-base">
            pgvector&rsquo;s HNSW index is logarithmic in corpus size. That&rsquo;s
            why Spine can promise infinite memory without an apology: doubling
            the corpus barely touches p99.
          </p>
          <BenchLatencyChart runs={byScale} />
          {byScale.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="font-mono text-[10px] uppercase tracking-widest text-cream/40 text-left">
                    <th className="py-3 pr-6">Scale</th>
                    <th className="py-3 pr-6">p50</th>
                    <th className="py-3 pr-6">p95</th>
                    <th className="py-3 pr-6">p99</th>
                    <th className="py-3 pr-6">Accuracy</th>
                    <th className="py-3 pr-6">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cream/[0.06]">
                  {byScale.map((r) => (
                    <tr key={r.id} className="text-cream/75">
                      <td className="py-3 pr-6 font-mono">{fmt(r.scale)}</td>
                      <td className="py-3 pr-6 font-mono">{r.p50_latency_ms}ms</td>
                      <td className="py-3 pr-6 font-mono">{r.p95_latency_ms}ms</td>
                      <td className="py-3 pr-6 font-mono text-amber">{r.p99_latency_ms}ms</td>
                      <td className="py-3 pr-6 font-mono">{(r.recall_accuracy * 100).toFixed(1)}%</td>
                      <td className="py-3 pr-6 font-mono text-cream/40 text-[12px]">
                        {new Date(r.created_at).toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Method */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Method · reproducible
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-10">
            How the test works.
          </h2>

          <ol className="space-y-6">
            {[
              {
                n: '01',
                title: 'Seed a real corpus',
                body: 'scripts/scale-seed.mjs generates N synthetic memories — varied project notes, decisions, meeting snippets, not lorem ipsum — embeds each with text-embedding-3-small, and writes them to Supabase under a dedicated bench user. 1M memories takes ~$1 in OpenAI and a few minutes of inserts.',
              },
              {
                n: '02',
                title: 'Hide the needles',
                body: 'scripts/scale-bench.mjs inserts K uniquely-tokened memories into the same haystack. Each needle contains a SHA-derived identifier that appears nowhere else in the corpus.',
              },
              {
                n: '03',
                title: 'Ask Spine to find them',
                body: 'For each needle, fire a natural-language query against the production retrieval pipeline. Measure end-to-end latency from the bench script. Check whether the needle appears in top-K results.',
              },
              {
                n: '04',
                title: 'Publish the numbers',
                body: 'Every run writes to saas_spine_bench_runs in Supabase. This page reads that table live. Nothing on this page is mocked, averaged across attempts, or curated. The latest row wins.',
              },
            ].map((s) => (
              <li key={s.n} className="grid grid-cols-[40px,1fr] md:grid-cols-[60px,1fr] gap-4 md:gap-10 py-5 border-b border-cream/[0.06]">
                <span className="font-mono text-[11px] text-cream/35 md:pt-0.5">{s.n}</span>
                <div>
                  <p className="font-serif text-xl md:text-2xl text-cream mb-2">{s.title}</p>
                  <p className="text-cream/55 leading-relaxed text-[15px]">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Run-it-yourself */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Run it yourself
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-10">
            No trust required.
          </h2>

          <div className="space-y-4 font-mono text-[13px]">
            {[
              { cmt: '# 1. Set up env: Supabase URL + service role + OpenAI + bench user ID', cmd: null },
              { cmt: null, cmd: 'export SPINE_BENCH_USER_ID=<uuid>' },
              { cmt: '# 2. Seed the corpus (10k / 100k / 1M — your call)', cmd: null },
              { cmt: null, cmd: 'node scripts/scale-seed.mjs --count 1000000' },
              { cmt: '# 3. Run the benchmark (inserts needles, runs queries, writes results)', cmd: null },
              { cmt: null, cmd: 'node scripts/scale-bench.mjs --needles 20 --queries 100 --top-k 5' },
              { cmt: '# 4. This page refreshes within a minute', cmd: null },
            ].map((l, i) => (
              <div key={i}>
                {l.cmt && <p className="text-cream/35">{l.cmt}</p>}
                {l.cmd && (
                  <p className="text-amber/90 bg-amber/[0.04] border border-amber/20 px-4 py-3 select-all">
                    <span className="text-cream/30 select-none mr-2">$</span>
                    {l.cmd}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honest ceiling */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto border-l-2 border-amber/45 pl-5 md:pl-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-4">
            § Honest ceiling
          </p>
          <p className="font-serif italic text-xl md:text-2xl text-cream/85 leading-snug mb-4">
            &ldquo;Scale without accuracy is a party trick. We publish both.&rdquo;
          </p>
          <p className="text-cream/55 text-[15px] leading-relaxed">
            Latency stays logarithmic because the HNSW index is designed for
            that. Accuracy at top-5 holds because the embedding model
            (text-embedding-3-small, 1536 dims) separates distinct semantic
            content well enough that unique needle tokens don&rsquo;t collide
            with the synthetic haystack. Where this test{' '}
            <em className="italic">doesn&rsquo;t</em> generalise: real corpora
            have near-duplicates, stale content, and adversarial similarity —
            which is exactly what the v1.1 superseded_by chain and
            per-session de-dup address.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl text-cream leading-tight">
              Your memory is appendable.
              <br />
              Your AI&rsquo;s should be too.
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              One corpus · every AI · forever
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
