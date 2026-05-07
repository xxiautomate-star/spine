// POST /api/cron/benchmarks
// Called by Coolify/Vercel cron weekly (Sunday 02:00 UTC by convention).
// Auth: CRON_SECRET bearer token.
//
// Runs the recall-quality eval against this same deployment's
// /api/recall endpoint and persists one row to benchmark_runs.
// The /proof page reads the latest row.

import { NextResponse, type NextRequest } from 'next/server';
import { runBenchmark, persistRun } from '@/lib/benchmarks-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 30 queries × ~1s each = ~30s; safe ceiling

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  }

  // The cron must hit the SAME deployment — running benchmarks against
  // a different cluster would publish numbers that don't match what
  // users actually see. We default to NEXT_PUBLIC_APP_URL but allow
  // override via HARNESS_BASE_URL for staging-runs-against-prod-style
  // experiments.
  const baseUrl =
    process.env.HARNESS_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://spine.xxiautomate.com';
  const apiKey = process.env.HARNESS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'HARNESS_API_KEY not configured.' },
      { status: 500 }
    );
  }

  try {
    const result = await runBenchmark(baseUrl, apiKey);
    const inserted = await persistRun(result, `cron at ${new Date().toISOString()}`);
    return NextResponse.json({
      ok: true,
      runId: inserted?.id ?? null,
      result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Benchmark failed.',
      },
      { status: 500 }
    );
  }
}

// Vercel cron sends GET with the bearer token. Same handler.
export async function GET(req: NextRequest) {
  return POST(req);
}
