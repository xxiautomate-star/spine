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
  updated_at: string;
};

export async function GET(): Promise<NextResponse> {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Stats unavailable — Supabase not configured.' }, { status: 503 });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [memRes, recallRes, costRes] = await Promise.all([
    supabase.from('memories').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase
      .from('saas_spine_recall_events')
      .select('latency_ms, cross_session, created_at', { count: 'exact' })
      .gte('created_at', since),
    supabase
      .from('saas_spine_recall_events')
      .select('rerank_cost_usd, embed_cost_usd'),
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

  const stats: SpineStats = {
    total_memories: totalMemories,
    cross_session_recalls_7d: crossSessionRecalls7d,
    total_recalls_7d: totalRecalls7d,
    avg_latency_ms: avgLatency,
    memories_per_dollar: memoriesPerDollar,
    total_spend_usd: Number(totalSpend.toFixed(4)),
    updated_at: new Date().toISOString(),
  };

  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=600',
    },
  });
}
