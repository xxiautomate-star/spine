// Nightly weight-retrain cron endpoint. Point a scheduled request at this
// URL with the CRON_SECRET bearer token. Runs the same logistic regression
// the script runs, but in-process so Coolify/Vercel can wire it to a
// schedule without shelling out to Node.
//
// Gated on CRON_SECRET — a request without the right token returns 403.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LR = 0.1;
const ITERS = 600;
const L2 = 0.01;
const MIN_POSITIVES = 20;

function sigmoid(z: number) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

type Sample = {
  why_bm25: number;
  why_vec: number;
  why_recency: number;
  why_centrality: number;
  label: boolean;
  user_id: string | null;
};

async function loadSamples(sb: ReturnType<typeof getSupabase>, userId: string | null): Promise<Sample[]> {
  if (!sb) return [];
  const pageSize = 2000;
  const all: Sample[] = [];
  let from = 0;
  let q = sb
    .from('spine_training_samples')
    .select('user_id, why_bm25, why_vec, why_recency, why_centrality, label');
  if (userId) q = q.eq('user_id', userId);

  while (true) {
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) {
      all.push({
        why_bm25: Number(r.why_bm25 ?? 0),
        why_vec: Number(r.why_vec ?? 0),
        why_recency: Number(r.why_recency ?? 0),
        why_centrality: Number(r.why_centrality ?? 0),
        label: r.label === true,
        user_id: (r.user_id as string | null) ?? null,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > 100_000) break;
  }
  return all;
}

function train(samples: Sample[]) {
  const n = samples.length;
  if (n === 0) return null;
  const positives = samples.filter((s) => s.label).length;
  const negatives = n - positives;
  if (positives < MIN_POSITIVES) return { skipped: true, positives, negatives, n };

  const posWeight = negatives / Math.max(1, positives);
  let w = [0.25, 0.55, 0.1, 0.1];
  let b = 0;

  for (let iter = 0; iter < ITERS; iter++) {
    const gw = [0, 0, 0, 0];
    let gb = 0;
    for (const s of samples) {
      const x = [s.why_bm25, s.why_vec, s.why_recency, s.why_centrality];
      const y = s.label ? 1 : 0;
      const wt = y === 1 ? posWeight : 1;
      const z = x[0] * w[0] + x[1] * w[1] + x[2] * w[2] + x[3] * w[3] + b;
      const err = (sigmoid(z) - y) * wt;
      for (let k = 0; k < 4; k++) gw[k] += err * x[k];
      gb += err;
    }
    for (let k = 0; k < 4; k++) w[k] -= (LR / n) * (gw[k] + L2 * w[k]);
    b -= (LR / n) * gb;
  }

  const scored = samples.map((s) => {
    const x = [s.why_bm25, s.why_vec, s.why_recency, s.why_centrality];
    const z = x[0] * w[0] + x[1] * w[1] + x[2] * w[2] + x[3] * w[3] + b;
    return { score: sigmoid(z), y: s.label ? 1 : 0 };
  }).sort((a, b) => b.score - a.score);
  const P = scored.filter((r) => r.y === 1).length;
  const N = scored.length - P;
  let rankSum = 0;
  scored.forEach((row, i) => {
    if (row.y === 1) rankSum += scored.length - i;
  });
  const auc = (rankSum - (P * (P + 1)) / 2) / Math.max(1, P * N);

  return { skipped: false, w, b, n, auc, positives, negatives };
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    req.nextUrl.searchParams.get('secret');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  try {
    const samples = await loadSamples(sb, null);
    const result = train(samples);
    if (!result) {
      return NextResponse.json({ ok: false, reason: 'no samples' });
    }
    if (result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `only ${result.positives} positives — need ≥${MIN_POSITIVES}`,
        positives: result.positives,
        negatives: result.negatives,
      });
    }

    const raw = result.w!.map((x) => Math.max(0, x));
    const sum = raw.reduce((s, x) => s + x, 0) || 1;
    const norm = raw.map((x) => x / sum);

    await sb
      .from('spine_rerank_weights')
      .update({ is_active: false })
      .is('user_id', null)
      .eq('is_active', true);

    const row = {
      user_id: null,
      bm25_w: norm[0],
      vec_w: norm[1],
      recency_w: norm[2],
      centrality_w: norm[3],
      bias: result.b!,
      training_n: result.n,
      training_auc: result.auc,
      model_version: 'lr-v2-real',
      is_active: true,
      notes: `cron-retrain · auc ${result.auc!.toFixed(3)} · ${result.positives}p/${result.negatives}n`,
    };
    const { error } = await sb.from('spine_rerank_weights').insert(row);
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      trained: {
        samples: result.n,
        positives: result.positives,
        negatives: result.negatives,
        auc: result.auc,
        weights: norm,
        bias: result.b,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 500 }
    );
  }
}

// GET variant for platforms that require GET for cron hooks.
export async function GET(req: NextRequest) {
  return POST(req);
}
