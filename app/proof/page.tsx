// /proof — public benchmark page (Gate D).
//
// The page Roman links from launch tweets. "We measured. Here's what
// we got." No auth — anyone hitting spine.xxiautomate.com/proof gets
// the latest harness numbers, the comparison table, the methodology,
// and a CSV export link.
//
// Reads the most-recent row from benchmark_runs. Falls back to a
// calibration baseline if the table is empty (fresh install). The
// scripts/refresh-benchmarks.ts cron writes a new row weekly.

import type { Metadata } from 'next';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import {
  BenchmarkRun,
  CALIBRATION_RUN,
  COMPARISON_REFERENCE,
  fmtCount,
  fmtMs,
  fmtPercent,
} from '@/lib/benchmarks';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Proof — Spine',
  description:
    "Live benchmark numbers from Spine's recall-quality harness. Precision, false-positive rate, latency. Open data — replicable.",
};

async function loadLatest(): Promise<BenchmarkRun> {
  const sb = getSupabase();
  if (!sb) return CALIBRATION_RUN;
  try {
    const { data, error } = await sb
      .from('benchmark_runs')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return CALIBRATION_RUN;
    return {
      id: data.id,
      ranAt: data.ran_at,
      precisionAt5: data.precision_at_5,
      recallAt10: data.recall_at_10,
      falsePositiveRate: data.false_positive_rate,
      medianLatencyMs: data.median_latency_ms,
      p95LatencyMs: data.p95_latency_ms,
      corpusSize: data.corpus_size,
      queryCount: data.query_count,
      harnessName: data.harness_name,
      notes: data.notes,
      totalMemoriesCount: data.total_memories_count,
      totalUsersCount: data.total_users_count,
      extra: (data.extra as Record<string, unknown> | null) ?? {},
    };
  } catch {
    return CALIBRATION_RUN;
  }
}

export default async function ProofPage() {
  const latest = await loadLatest();
  const isCalibration = latest.id === 'calibration';

  // Build the comparison table — Spine row is filled in from the live
  // benchmark, the rest are static cited claims.
  const rows = COMPARISON_REFERENCE.map((r) =>
    r.vendor === 'Spine'
      ? {
          ...r,
          precisionAt5: latest.precisionAt5,
          falsePositiveRate: latest.falsePositiveRate,
        }
      : r
  );

  return (
    <main className="relative bg-[#0D0C0A] text-[#E8E4DD] overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-1/4 left-[8%] w-[480px] h-[480px] rounded-full bg-[#E89A3C]/[0.06] blur-[180px]" />
        <div className="absolute bottom-[10%] right-[8%] w-[420px] h-[320px] rounded-full bg-[#4A5E7A]/[0.08] blur-[160px]" />
      </div>

      {/* Hero */}
      <section className="relative px-6 md:px-16 pt-28 md:pt-36 pb-20 max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-8">
          § Proof · public benchmark
        </p>
        <h1 className="font-serif text-[2.8rem] leading-[1.0] md:text-[5.5rem] md:leading-[0.98] text-cream tracking-tight">
          We measured.
          <br />
          <em className="italic text-[#E89A3C]">Here's what we got.</em>
        </h1>
        <p className="mt-10 max-w-2xl text-lg text-cream/65 leading-relaxed">
          Most memory companies publish features, not numbers. We publish numbers. The harness
          re-runs every week against a fixed corpus; this page renders the most recent result.
          Methodology and raw CSV are at the bottom.
        </p>
        <p className="mt-3 max-w-2xl text-cream/45">
          Spine is append-only — every word, never compacted, recallable. The metrics below are
          measured on a system that doesn't summarise to fit a context window.
        </p>
      </section>

      {/* Live numbers */}
      <section className="relative px-6 md:px-16 pb-20 max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 001 · Latest run
        </p>
        <div className="mb-2 font-mono text-[11px] text-cream/45">
          {isCalibration ? 'Calibration baseline (cron not yet wired)' : `Run at ${new Date(latest.ranAt).toLocaleString()}`} · {latest.harnessName} · {latest.corpusSize}-memory corpus, {latest.queryCount} queries
        </div>
        <div className="grid md:grid-cols-4 gap-4 mt-8">
          <BigStat
            label="Precision @ 5"
            value={fmtPercent(latest.precisionAt5, 1)}
            hint="Top-5 recall hit rate"
            accent="amber"
          />
          <BigStat
            label="Recall @ 10"
            value={fmtPercent(latest.recallAt10, 1)}
            hint="Coverage in the top 10"
          />
          <BigStat
            label="False-positive rate"
            value={fmtPercent(latest.falsePositiveRate, 1)}
            hint="Off-topic queries surfacing signal"
          />
          <BigStat
            label="Median latency"
            value={fmtMs(latest.medianLatencyMs)}
            hint={`p95 ${fmtMs(latest.p95LatencyMs)}`}
          />
        </div>
        {(latest.totalMemoriesCount || latest.totalUsersCount) && (
          <div className="mt-12 flex flex-wrap gap-x-12 gap-y-4 font-mono text-[12px] text-cream/55">
            {latest.totalMemoriesCount !== null && (
              <div>
                <span className="text-cream/30 uppercase tracking-widest text-[10px] mr-2">
                  Memories captured
                </span>
                <span className="text-cream font-serif text-2xl">
                  {fmtCount(latest.totalMemoriesCount)}
                </span>
              </div>
            )}
            {latest.totalUsersCount !== null && (
              <div>
                <span className="text-cream/30 uppercase tracking-widest text-[10px] mr-2">
                  Users
                </span>
                <span className="text-cream font-serif text-2xl">
                  {fmtCount(latest.totalUsersCount)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Compaction proof — the headline thesis */}
      <section className="relative px-6 md:px-16 py-16 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 001a · Compaction proof
        </p>
        <h2 className="font-serif text-3xl md:text-5xl text-cream leading-[1.1] mb-6 max-w-3xl">
          Claude folded turn 3.
          <br />
          <em className="italic text-[#E89A3C]">Spine returned it verbatim.</em>
        </h2>
        <p className="text-cream/65 leading-relaxed mb-8 max-w-2xl">
          The numbers above measure recall quality. They don&rsquo;t prove
          the headline thesis on their own. The compaction-proof page does:
          one captured session, 142 turns, compaction at turn 84, Spine
          recalled the turn-3 architectural decision in 187ms — byte-identical
          to the original.
        </p>
        <Link
          href="/proof/compaction"
          className="inline-flex items-center gap-2 px-5 py-3 border border-[#E89A3C]/40 text-[#E89A3C] font-mono text-[11px] uppercase tracking-widest hover:bg-[#E89A3C]/[0.04] transition-colors duration-300"
        >
          See the receipt →
        </Link>
      </section>

      {/* Comparison table */}
      <section className="relative px-6 md:px-16 py-20 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 002 · How we compare
        </p>
        <h2 className="font-serif text-3xl md:text-5xl text-cream leading-[1.1] mb-10 max-w-3xl">
          Honest cross-vendor numbers.
        </h2>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-cream/[0.12]">
                <th className="py-4 pr-4 font-mono text-[10px] uppercase tracking-widest text-cream/40 font-medium">
                  Vendor
                </th>
                <th className="py-4 px-4 font-mono text-[10px] uppercase tracking-widest text-cream/40 font-medium text-right">
                  Precision @ 5
                </th>
                <th className="py-4 px-4 font-mono text-[10px] uppercase tracking-widest text-cream/40 font-medium text-right">
                  False-positive rate
                </th>
                <th className="py-4 pl-4 font-mono text-[10px] uppercase tracking-widest text-cream/40 font-medium">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSpine = r.vendor === 'Spine';
                return (
                  <tr key={r.vendor} className="border-b border-cream/[0.06]">
                    <td className="py-5 pr-4 align-top">
                      <span
                        className={`font-serif text-lg ${
                          isSpine ? 'text-[#E89A3C]' : 'text-cream/70'
                        }`}
                      >
                        {r.vendor}
                      </span>
                      {isSpine && (
                        <span className="block font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/65 mt-1">
                          live
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-5 px-4 font-mono text-right align-top ${
                        isSpine ? 'text-[#E89A3C] text-xl' : 'text-cream/70 text-base'
                      }`}
                    >
                      {fmtPercent(r.precisionAt5, 1)}
                    </td>
                    <td
                      className={`py-5 px-4 font-mono text-right align-top ${
                        isSpine ? 'text-[#E89A3C] text-xl' : 'text-cream/70 text-base'
                      }`}
                    >
                      {fmtPercent(r.falsePositiveRate, 1)}
                    </td>
                    <td className="py-5 pl-4 align-top">
                      <p className="text-cream/55 text-[13px] leading-relaxed">{r.notes}</p>
                      {r.citation && (
                        <p className="font-mono text-[10px] text-cream/30 mt-1">
                          source: {r.citation}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-8 font-mono text-[10px] text-cream/30 leading-relaxed max-w-3xl">
          Cross-vendor comparison is hard. Different corpora measure different
          phenomena. We restate Mem0's published claim against a no-memory baseline so a careful reader has a number to anchor; we don't pretend to have run their eval. Want to replicate ours? Methodology + CSV below.
        </p>
      </section>

      {/* Methodology */}
      <section className="relative px-6 md:px-16 py-20 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 003 · Methodology
        </p>
        <h2 className="font-serif text-3xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          How the numbers above are produced.
        </h2>

        <div className="space-y-7 text-cream/65 leading-relaxed max-w-3xl">
          <div>
            <h3 className="font-serif text-xl text-cream mb-2">Corpus</h3>
            <p>
              {latest.corpusSize} first-person memories across 5 distinct themes
              (tech / travel / cooking / fitness / books, 40 each). Each memory
              carries a theme tag so we know the ground-truth label at query
              time. Source:{' '}
              <code className="font-mono text-[12px] text-[#E89A3C]/80">
                tests/fixtures/recall-quality-data.ts
              </code>{' '}
              in the open repo.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-cream mb-2">Queries</h3>
            <p>
              {latest.queryCount} queries — 6 per theme — phrased like real
              questions a user would ask their AI. We measure precision @ 5 (of
              the top 5 hits, how many carry the matching theme tag) and
              recall @ 10 (of the 40 ground-truth memories, how many appear in
              the top 10 across the theme's 6 queries).
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-cream mb-2">Latency</h3>
            <p>
              Wall-clock round-trip time of the{' '}
              <code className="font-mono text-[12px] text-[#E89A3C]/80">/api/recall</code>{' '}
              POST. Median over the {latest.queryCount}-query run; p95 surfaced
              for tail-aware reading. Run from the same region as our Postgres
              (Sydney) — production users elsewhere see network RTT on top.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-cream mb-2">False-positive rate</h3>
            <p>
              We additionally run 20 queries that should NOT hit (chord
              progression for canon in D, best yoga poses for back pain). FP
              rate is the fraction of result slots in the top 5 that come back
              tagged with a project/topic memory. A perfect retriever returns
              zero on these.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl text-cream mb-2">Replicate</h3>
            <p>
              The full corpus, queries, and harness ship in the public repo at{' '}
              <a
                href="https://github.com/xxiautomate-star/xxiautomate-dashboard"
                className="text-[#E89A3C] hover:text-cream"
              >
                xxiautomate-star/xxiautomate-dashboard
              </a>
              . Run{' '}
              <code className="font-mono text-[12px] text-[#E89A3C]/80">
                npm run test:recall-quality
              </code>{' '}
              against any deployed Spine — same numbers, same fixtures.
            </p>
          </div>
        </div>
      </section>

      {/* Open data */}
      <section className="relative px-6 md:px-16 py-20 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 004 · Open data
        </p>
        <h2 className="font-serif text-3xl md:text-4xl text-cream leading-[1.15] mb-6 max-w-3xl">
          Every recorded run.
        </h2>
        <p className="text-cream/65 leading-relaxed mb-8 max-w-2xl">
          One row per harness execution. Contains the same metrics as the
          headline above plus methodology fields so anyone can re-replay
          without guessing what changed.
        </p>
        <Link
          href="/api/proof/csv"
          className="inline-flex items-center gap-2 px-5 py-3 border border-[#E89A3C]/40 text-[#E89A3C] font-mono text-[11px] uppercase tracking-widest hover:bg-[#E89A3C]/[0.04] transition-colors duration-300"
        >
          Download CSV →
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative px-6 md:px-16 py-14 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="block w-2 h-2 rounded-full bg-[#E89A3C]" />
              <p className="font-serif text-2xl text-cream">Spine</p>
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-cream/30">
              The memory layer that publishes its work.
            </p>
          </div>
          <Link
            href="/"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/40 hover:text-[#E89A3C] transition-colors"
          >
            ← back to spine.xxiautomate.com
          </Link>
        </div>
      </footer>
    </main>
  );
}

function BigStat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: 'amber' | undefined;
}) {
  const valueColor = accent === 'amber' ? 'text-[#E89A3C]' : 'text-cream';
  return (
    <div className="border border-cream/[0.08] rounded-xl p-6 bg-cream/[0.02]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
        {label}
      </p>
      <p className={`font-serif text-5xl ${valueColor} leading-none`}>{value}</p>
      <p className="mt-3 font-mono text-[10px] text-cream/35 leading-relaxed">{hint}</p>
    </div>
  );
}
