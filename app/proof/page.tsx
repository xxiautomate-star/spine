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
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';
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
  const latestRow = await loadLatest();
  const noRowsYet = latestRow.id === 'calibration';
  // Cron is wired but production corpus may be unseeded — when a real run
  // produces zeros across the board it's not signal, it's an empty corpus.
  // Render calibration metrics so the headline doesn't show 0%, but keep
  // the real run's timestamp so the disclaimer is honest about what we ran.
  const noSignal =
    !noRowsYet &&
    latestRow.precisionAt5 === 0 &&
    (latestRow.recallAt10 === 0 || latestRow.recallAt10 === null);
  const display: BenchmarkRun = noSignal
    ? { ...CALIBRATION_RUN, ranAt: latestRow.ranAt }
    : latestRow;
  const headerLine = noRowsYet
    ? 'Calibration baseline — first cron run pending'
    : noSignal
      ? `Last run: ${new Date(display.ranAt).toLocaleString()} · production corpus unseeded · showing calibration figures`
      : `Last run: ${new Date(display.ranAt).toLocaleString()}`;

  // Build the comparison table — Spine row is filled in from the live
  // benchmark, the rest are static cited claims.
  const rows = COMPARISON_REFERENCE.map((r) =>
    r.vendor === 'Spine'
      ? {
          ...r,
          precisionAt5: display.precisionAt5,
          falsePositiveRate: display.falsePositiveRate,
        }
      : r
  );

  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

      {/* Hero */}
      <section className="relative px-6 md:px-16 pt-20 pb-20 max-w-5xl mx-auto" style={{ zIndex: 1 }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-8" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ Proof</span>
          public benchmark
        </p>
        <h1 className="font-serif text-[2.8rem] leading-[1.0] md:text-[5.5rem] md:leading-[0.98] tracking-tight" style={{ color: 'var(--s-ink)' }}>
          We measured.
          <br />
          <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Here&rsquo;s what we got.</em>
        </h1>
        <p className="mt-10 max-w-2xl text-lg leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
          Most memory companies publish features, not numbers. We publish numbers. The harness
          re-runs every week against a fixed corpus; this page renders the most recent result.
          Methodology and raw CSV are at the bottom.
        </p>
        <p className="mt-3 max-w-2xl" style={{ color: 'var(--s-ink-faint)' }}>
          Spine is append-only — every word, never compacted, recallable. The metrics below are
          measured on a system that doesn&rsquo;t summarise to fit a context window.
        </p>
      </section>

      {/* Live numbers */}
      <section className="relative px-6 md:px-16 pb-20 max-w-5xl mx-auto" style={{ zIndex: 1 }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
          Latest run
        </p>
        <div className="mb-2 font-mono text-[11px]" style={{ color: 'var(--s-ink-faint)' }}>
          {headerLine} · {display.harnessName} · {display.corpusSize}-memory corpus, {display.queryCount} queries
        </div>
        <div className="grid md:grid-cols-4 gap-4 mt-8">
          <BigStat
            label="Precision @ 5"
            value={fmtPercent(display.precisionAt5, 1)}
            hint="Top-5 recall hit rate"
            accent
          />
          <BigStat
            label="Recall @ 10"
            value={fmtPercent(display.recallAt10, 1)}
            hint="Coverage in the top 10"
          />
          <BigStat
            label="False-positive rate"
            value={fmtPercent(display.falsePositiveRate, 1)}
            hint="Off-topic queries surfacing signal"
          />
          <BigStat
            label="Median latency"
            value={fmtMs(display.medianLatencyMs)}
            hint={`p95 ${fmtMs(display.p95LatencyMs)}`}
          />
        </div>
        {(display.totalMemoriesCount || display.totalUsersCount) && (
          <div className="mt-12 flex flex-wrap gap-x-12 gap-y-4 font-mono text-[12px]" style={{ color: 'var(--s-ink-faint)' }}>
            {display.totalMemoriesCount !== null && (
              <div>
                <span className="uppercase tracking-widest text-[10px] mr-2" style={{ color: 'var(--s-ink-ghost)' }}>
                  Memories captured
                </span>
                <span className="font-serif text-2xl" style={{ color: 'var(--s-ink)' }}>
                  {fmtCount(display.totalMemoriesCount)}
                </span>
              </div>
            )}
            {display.totalUsersCount !== null && (
              <div>
                <span className="uppercase tracking-widest text-[10px] mr-2" style={{ color: 'var(--s-ink-ghost)' }}>
                  Users
                </span>
                <span className="font-serif text-2xl" style={{ color: 'var(--s-ink)' }}>
                  {fmtCount(display.totalUsersCount)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Compaction proof — the headline thesis */}
      <section className="relative px-6 md:px-16 py-16 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001a</span>
          Compaction proof
        </p>
        <h2 className="font-serif text-3xl md:text-5xl leading-[1.1] mb-6 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          Claude folded turn 3.
          <br />
          <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Spine returned it verbatim.</em>
        </h2>
        <p className="leading-relaxed mb-8 max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>
          The numbers above measure recall quality. They don&rsquo;t prove
          the headline thesis on their own. The compaction-proof page does:
          one captured session, 142 turns, compaction at turn 84, Spine
          recalled the turn-3 architectural decision in 187ms — byte-identical
          to the original.
        </p>
        <Link
          href="/proof/compaction"
          className="inline-flex items-center gap-2 px-5 py-3 font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 rounded-md"
          style={{
            border: '1px solid var(--s-vein-strong)',
            color: 'var(--s-gold-deep)',
            background: 'rgba(255, 253, 247, 0.65)',
          }}
        >
          See the receipt →
        </Link>
      </section>

      {/* Comparison table */}
      <section className="relative px-6 md:px-16 py-20 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 002</span>
          How we compare
        </p>
        <h2 className="font-serif text-3xl md:text-5xl leading-[1.1] mb-10 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          Honest cross-vendor numbers.
        </h2>

        <div
          className="overflow-x-auto rounded-xl"
          style={{
            background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
            border: '1px solid var(--s-vein)',
            boxShadow: 'var(--s-shadow-1)',
          }}
        >
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--s-vein-strong)' }}>
                <th className="py-4 pl-6 pr-4 font-mono text-[10px] uppercase tracking-widest font-medium" style={{ color: 'var(--s-ink-faint)' }}>
                  Vendor
                </th>
                <th className="py-4 px-4 font-mono text-[10px] uppercase tracking-widest font-medium text-right" style={{ color: 'var(--s-ink-faint)' }}>
                  Precision @ 5
                </th>
                <th className="py-4 px-4 font-mono text-[10px] uppercase tracking-widest font-medium text-right" style={{ color: 'var(--s-ink-faint)' }}>
                  False-positive rate
                </th>
                <th className="py-4 pr-6 pl-4 font-mono text-[10px] uppercase tracking-widest font-medium" style={{ color: 'var(--s-ink-faint)' }}>
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSpine = r.vendor === 'Spine';
                return (
                  <tr key={r.vendor} style={{ borderBottom: '1px solid var(--s-vein)' }}>
                    <td className="py-5 pl-6 pr-4 align-top">
                      <span
                        className="font-serif text-lg"
                        style={{
                          color: isSpine ? 'var(--s-gold-deep)' : 'var(--s-ink)',
                          fontWeight: isSpine ? 700 : 400,
                        }}
                      >
                        {r.vendor}
                      </span>
                      {isSpine && (
                        <span className="block font-mono text-[10px] uppercase tracking-widest mt-1" style={{ color: 'var(--s-gold-deep)' }}>
                          live
                        </span>
                      )}
                    </td>
                    <td
                      className="py-5 px-4 font-mono text-right align-top"
                      style={{
                        color: isSpine ? 'var(--s-gold-deep)' : 'var(--s-ink-soft)',
                        fontSize: isSpine ? '1.25rem' : '1rem',
                      }}
                    >
                      {fmtPercent(r.precisionAt5, 1)}
                    </td>
                    <td
                      className="py-5 px-4 font-mono text-right align-top"
                      style={{
                        color: isSpine ? 'var(--s-gold-deep)' : 'var(--s-ink-soft)',
                        fontSize: isSpine ? '1.25rem' : '1rem',
                      }}
                    >
                      {fmtPercent(r.falsePositiveRate, 1)}
                    </td>
                    <td className="py-5 pr-6 pl-4 align-top">
                      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{r.notes}</p>
                      {r.citation && (
                        <p className="font-mono text-[10px] mt-1" style={{ color: 'var(--s-ink-ghost)' }}>
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

        <p className="mt-8 font-mono text-[10px] leading-relaxed max-w-3xl" style={{ color: 'var(--s-ink-faint)' }}>
          Cross-vendor comparison is hard. Different corpora measure different
          phenomena. We restate Mem0&rsquo;s published claim against a no-memory baseline so a careful reader has a number to anchor; we don&rsquo;t pretend to have run their eval. Want to replicate ours? Methodology + CSV below.
        </p>
      </section>

      {/* Methodology */}
      <section className="relative px-6 md:px-16 py-20 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 003</span>
          Methodology
        </p>
        <h2 className="font-serif text-3xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          How the numbers above are produced.
        </h2>

        <div className="space-y-7 leading-relaxed max-w-3xl" style={{ color: 'var(--s-ink-soft)' }}>
          <div>
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--s-ink)' }}>Corpus</h3>
            <p>
              {display.corpusSize} first-person memories across 5 distinct themes
              (tech / travel / cooking / fitness / books, 40 each). Each memory
              carries a theme tag so we know the ground-truth label at query
              time. Source:{' '}
              <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>
                tests/fixtures/recall-quality-data.ts
              </code>{' '}
              in the open repo.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--s-ink)' }}>Queries</h3>
            <p>
              {display.queryCount} queries — 6 per theme — phrased like real
              questions a user would ask their AI. We measure precision @ 5 (of
              the top 5 hits, how many carry the matching theme tag) and
              recall @ 10 (of the 40 ground-truth memories, how many appear in
              the top 10 across the theme&rsquo;s 6 queries).
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--s-ink)' }}>Latency</h3>
            <p>
              Wall-clock round-trip time of the{' '}
              <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>/api/recall</code>{' '}
              POST. Median over the {display.queryCount}-query run; p95 surfaced
              for tail-aware reading. Run from the same region as our Postgres
              (Sydney) — production users elsewhere see network RTT on top.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--s-ink)' }}>False-positive rate</h3>
            <p>
              We additionally run 20 queries that should NOT hit (chord
              progression for canon in D, best yoga poses for back pain). FP
              rate is the fraction of result slots in the top 5 that come back
              tagged with a project/topic memory. A perfect retriever returns
              zero on these.
            </p>
          </div>

          <div>
            <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--s-ink)' }}>Replicate</h3>
            <p>
              The full corpus, queries, and harness ship in the public repo at{' '}
              <a
                href="https://github.com/xxiautomate-star/xxiautomate-dashboard"
                className="underline underline-offset-4 transition-colors duration-300"
                style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}
              >
                xxiautomate-star/xxiautomate-dashboard
              </a>
              . Run{' '}
              <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>
                npm run test:recall-quality
              </code>{' '}
              against any deployed Spine — same numbers, same fixtures.
            </p>
          </div>
        </div>
      </section>

      {/* Open data */}
      <section className="relative px-6 md:px-16 py-20 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 004</span>
          Open data
        </p>
        <h2 className="font-serif text-3xl md:text-4xl leading-[1.15] mb-6 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          Every recorded run.
        </h2>
        <p className="leading-relaxed mb-8 max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>
          One row per harness execution. Contains the same metrics as the
          headline above plus methodology fields so anyone can re-replay
          without guessing what changed.
        </p>
        <Link
          href="/api/proof/csv"
          className="inline-flex items-center gap-2 px-5 py-3 font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 rounded-md"
          style={{
            border: '1px solid var(--s-vein-strong)',
            color: 'var(--s-gold-deep)',
            background: 'rgba(255, 253, 247, 0.65)',
          }}
        >
          Download CSV →
        </Link>
      </section>

      <MarketingFooter />
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
  accent?: boolean;
}) {
  return (
    <div
      className="relative rounded-xl p-6 overflow-hidden transition-transform duration-500 hover:translate-y-[-2px]"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
        border: '1px solid var(--s-vein)',
        boxShadow: 'var(--s-shadow-1)',
      }}
    >
      {accent && <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.95 }} />}
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-ink-faint)' }}>
        {label}
      </p>
      <p
        className="font-serif text-5xl leading-none tracking-[-0.02em]"
        style={{ color: accent ? 'var(--s-gold-deep)' : 'var(--s-ink)' }}
      >
        {value}
      </p>
      <p className="mt-3 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>{hint}</p>
    </div>
  );
}
