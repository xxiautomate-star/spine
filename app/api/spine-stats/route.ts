import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 60;

export type SpineStats = {
  total_memories: number;
  cross_session_recalls_7d: number;
  total_recalls_7d: number;
  avg_latency_ms: number | null;
  memories_per_dollar: number | null;
  total_spend_usd: number;
  largest_scale_tested: number | null;
  largest_scale_p99_ms: number | null;
  largest_scale_accuracy: number | null;
  ranker_auc: number | null;
  ranker_auc_prev: number | null;
  ranker_model: string | null;
  ranker_trained_at: string | null;
  updated_at: string;
};

export async function GET(): Promise<NextResponse> {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Stats unavailable — Supabase not configured.' }, { status: 503 });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [memRes, recallRes, costRes, benchRes, weightsRes] = await Promise.all([
    // Exclude bench memories so prod counts stay honest.
    supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .eq('is_bench', false),
    supabase
      .from('saas_spine_recall_events')
      .select('latency_ms, cross_session, created_at', { count: 'exact' })
      .gte('created_at', since),
    supabase
      .from('saas_spine_recall_events')
      .select('rerank_cost_usd, embed_cost_usd'),
    supabase
      .from('saas_spine_bench_runs')
      .select('scale, p99_latency_ms, recall_accuracy, created_at')
      .order('scale', { ascending: false })
      .limit(1),
    supabase
      .from('spine_rerank_weights')
      .select('model_version, training_auc, created_at, is_active, user_id')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .limit(2),
  ]);

  const totalMemories = memRes.count ?? 0;
  const events = (recallRes.data ?? []) as Array<{
    latency_ms: number;
    cross_session: boolean;
  }>;

  const totalRecalls7d = events.length;
  const crossSessionRecalls7d = events.filter((e) => e.cross_session).length;
  const avgLatency =
    events.length > 0
      ? Math.round(events.reduce((s, e) => s + (e.latency_ms ?? 0), 0) / events.length)
      : null;

  const costRows = (costRes.data ?? []) as Array<{
    rerank_cost_usd: number | string | null;
    embed_cost_usd: number | string | null;
  }>;
  const totalSpend = costRows.reduce(
    (s, r) => s + Number(r.rerank_cost_usd ?? 0) + Number(r.embed_cost_usd ?? 0),
    0
  );

  const memoriesPerDollar =
    totalSpend > 0 ? Math.round(totalMemories / totalSpend) : null;

  const benchTop = (benchRes.data ?? [])[0] as
    | { scale: number; p99_latency_ms: number; recall_accuracy: number }
    | undefined;

  const weightRows = (weightsRes.data ?? []) as Array<{
    model_version: string;
    training_auc: number | null;
    created_at: string;
    is_active: boolean;
  }>;
  const activeWeight = weightRows.find((w) => w.is_active) ?? weightRows[0] ?? null;
  const priorWeight = weightRows.find((w) => !w.is_active) ?? weightRows[1] ?? null;

  const stats: SpineStats = {
    total_memories: totalMemories,
    cross_session_recalls_7d: crossSessionRecalls7d,
    total_recalls_7d: totalRecalls7d,
    avg_latency_ms: avgLatency,
    memories_per_dollar: memoriesPerDollar,
    total_spend_usd: Number(totalSpend.toFixed(4)),
    largest_scale_tested: benchTop?.scale ?? null,
    largest_scale_p99_ms: benchTop?.p99_latency_ms ?? null,
    largest_scale_accuracy: benchTop?.recall_accuracy ?? null,
    ranker_auc: activeWeight?.training_auc ?? null,
    ranker_auc_prev: priorWeight?.training_auc ?? null,
    ranker_model: activeWeight?.model_version ?? null,
    ranker_trained_at: activeWeight?.created_at ?? null,
    updated_at: new Date().toISOString(),
  };

  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=600',
    },
  });
}
