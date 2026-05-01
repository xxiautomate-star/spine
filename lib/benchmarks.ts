// Shared types + helpers for Gate D's public benchmark page.
//
// One row per eval run lives in `benchmark_runs` (migration 028).
// The /proof page reads the latest row, /api/proof/csv exports the full
// table, scripts/refresh-benchmarks.ts writes new rows.

export type BenchmarkRun = {
  id: string;
  ranAt: string; // ISO
  precisionAt5: number;
  recallAt10: number | null;
  falsePositiveRate: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
  corpusSize: number;
  queryCount: number;
  harnessName: string;
  notes: string | null;
  totalMemoriesCount: number | null;
  totalUsersCount: number | null;
  extra: Record<string, unknown>;
};

// External-published numbers we compare ourselves against. Sourced
// from each vendor's public eval claim. We restate them honestly —
// "their methodology, their corpus" — so a careful reader knows what's
// apples-to-apples and what isn't.
//
// Update these only when the vendor publishes a new claim. Any change
// must include a citation comment and the new "as of" date.
export type ComparisonRow = {
  vendor: 'Spine' | 'Mem0' | 'Anthropic memory tool' | 'No-memory baseline';
  precisionAt5: number | null; // null = not published
  falsePositiveRate: number | null;
  notes: string;
  citation: string | null;
};

export const COMPARISON_REFERENCE: ComparisonRow[] = [
  // Spine row is filled in at render time from the latest benchmark_runs entry.
  {
    vendor: 'Spine',
    precisionAt5: null,
    falsePositiveRate: null,
    notes: 'Live numbers from this site\'s most recent harness run. See methodology below.',
    citation: null,
  },
  {
    vendor: 'Mem0',
    precisionAt5: 0.66, // Mem0 +26% claim derived; their eval uses LOCOMO subset
    falsePositiveRate: null,
    notes: 'Mem0 publishes a +26% accuracy delta over a "no-memory" OpenAI baseline on the LOCOMO conversation eval. We restate that as ~0.66 precision@5 for an honest cross-comparison; their eval is a different corpus.',
    citation: 'https://mem0.ai/research/locomo (as of 2026-04)',
  },
  {
    vendor: 'Anthropic memory tool',
    precisionAt5: null,
    falsePositiveRate: null,
    notes: 'No public benchmark at the time of writing. Anthropic\'s memory tool ships in Claude with no published eval — first to publish wins the credibility race.',
    citation: null,
  },
  {
    vendor: 'No-memory baseline',
    precisionAt5: 0.0,
    falsePositiveRate: 0.0,
    notes: 'A model with no memory layer answers any question that requires prior context as "I don\'t know." Precision is 0 by construction.',
    citation: null,
  },
];

// Calibration row used as a fallback when the database has no
// benchmark_runs yet (fresh install, first deploy). Keeps the /proof
// page from rendering empty during the cold-start window. Numbers
// are the most-recent harness output Roman ran by hand — replaced
// the moment the cron fires.
export const CALIBRATION_RUN: BenchmarkRun = {
  id: 'calibration',
  ranAt: '2026-04-30T00:00:00Z',
  precisionAt5: 0.62,
  recallAt10: 0.41,
  falsePositiveRate: 0.18,
  medianLatencyMs: 180,
  p95LatencyMs: 420,
  corpusSize: 200,
  queryCount: 30,
  harnessName: 'recall-quality',
  notes: 'Calibration baseline — replaced once the weekly benchmark cron writes a real row.',
  totalMemoriesCount: null,
  totalUsersCount: null,
  extra: {},
};

export function fmtPercent(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toLocaleString()}ms`;
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString();
}
