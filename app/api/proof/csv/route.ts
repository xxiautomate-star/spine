// GET /api/proof/csv — public CSV export of every benchmark run
// (Gate D's "open data" link).
//
// No auth. The benchmark_runs table is intended to be public — every
// row is a published number. Anyone hitting this URL gets the same
// CSV that the /proof page renders graphs from.
//
// Cap: 1000 rows. We only run the harness ~weekly so this gives 19+
// years of history. If the table ever grows past that, we'll add a
// `since=` query param.

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CSV_COLUMNS = [
  'ran_at',
  'precision_at_5',
  'recall_at_10',
  'false_positive_rate',
  'median_latency_ms',
  'p95_latency_ms',
  'corpus_size',
  'query_count',
  'harness_name',
  'total_memories_count',
  'total_users_count',
  'notes',
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Quote if it contains comma, quote, newline, or leading/trailing whitespace.
  if (/[,"\n\r]/.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const sb = getSupabase();
  if (!sb) {
    // Public endpoint — return an empty CSV with just the header row
    // rather than a 500. Lets `curl /api/proof/csv | wc -l` work even
    // before the DB is configured.
    return new NextResponse(CSV_COLUMNS.join(',') + '\n', {
      status: 200,
      headers: csvHeaders(),
    });
  }

  const { data, error } = await sb
    .from('benchmark_runs')
    .select(CSV_COLUMNS.join(','))
    .order('ran_at', { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json(
      { error: 'Failed to read benchmark_runs.', detail: error.message },
      { status: 500 }
    );
  }

  const lines: string[] = [CSV_COLUMNS.join(',')];
  // Supabase's typed select() narrows to a per-column-list shape we don't
  // need here — we just want to print whatever came back. Cast through
  // unknown to silence the strict overlap warning.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }

  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: csvHeaders(),
  });
}

function csvHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="spine-benchmark-runs.csv"',
    // Public endpoint — caching is fine for a few minutes. The harness
    // only writes weekly so a 5-min cache shaves load with zero staleness
    // cost in practice.
    'Cache-Control': 'public, max-age=300',
  };
}
