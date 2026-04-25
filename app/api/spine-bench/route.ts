import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 60;

export type BenchRun = {
  id: string;
  scale: number;
  needle_count: number;
  query_count: number;
  top_k: number;
  needles_found: number;
  recall_accuracy: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  embed_model: string | null;
  git_sha: string | null;
  created_at: string;
};

export type BenchSummary = {
  latest: BenchRun | null;
  by_scale: BenchRun[];
  max_scale: number;
  updated_at: string;
};

export async function GET(): Promise<NextResponse> {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('saas_spine_bench_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const runs = (data ?? []) as BenchRun[];

  // Keep latest run per scale bucket so the latency-vs-scale chart is clean.
  const byScaleMap = new Map<number, BenchRun>();
  for (const r of runs) {
    const bucket = bucketScale(r.scale);
    const existing = byScaleMap.get(bucket);
    if (!existing || r.created_at > existing.created_at) {
      byScaleMap.set(bucket, r);
    }
  }
  const byScale = [...byScaleMap.values()].sort((a, b) => a.scale - b.scale);
  const maxScale = runs.reduce((m, r) => Math.max(m, r.scale), 0);

  const summary: BenchSummary = {
    latest: runs[0] ?? null,
    by_scale: byScale,
    max_scale: maxScale,
    updated_at: new Date().toISOString(),
  };

  return NextResponse.json(summary, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=600' },
  });
}

// Snap scale to the nearest decade so repeat runs at ~1M collapse into one point.
function bucketScale(scale: number): number {
  if (scale <= 0) return 0;
  const log10 = Math.log10(scale);
  const bucket = Math.round(log10 * 2) / 2; // half-decade buckets (10x, 31x, 100x, ...)
  return Math.round(Math.pow(10, bucket));
}
