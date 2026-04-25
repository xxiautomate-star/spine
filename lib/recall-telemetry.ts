// Fire-and-forget telemetry for /spine/stats.
//
// Logs per-recall latency + cost to saas_spine_recall_events. `cross_session`
// is true when any returned memory was first stored more than 24h before the
// recall — the "your AI remembers from a prior session" proof metric.
//
// Never blocks the recall response. A failing insert is swallowed.

import { getSupabase } from './supabase';

export type TelemetryHit = {
  id: string;
  createdAt: string;
};

export function logRecallEvent(args: {
  userId: string | null;
  isDemo: boolean;
  queryLen: number;
  hits: TelemetryHit[];
  latencyMs: number;
  rerankCostUsd?: number;
  embedCostUsd?: number;
  plan?: string | null;
}): void {
  const supabase = getSupabase();
  if (!supabase) return;

  const now = Date.now();
  const crossSession = args.hits.some((h) => {
    const created = Date.parse(h.createdAt);
    return Number.isFinite(created) && now - created > 24 * 60 * 60 * 1000;
  });

  void supabase
    .from('saas_spine_recall_events')
    .insert({
      user_id: args.userId,
      is_demo: args.isDemo,
      query_len: args.queryLen,
      result_count: args.hits.length,
      latency_ms: args.latencyMs,
      rerank_cost_usd: args.rerankCostUsd ?? 0,
      embed_cost_usd: args.embedCostUsd ?? 0.000001, // rough estimate for text-embedding-3-small at ~50 tokens
      plan: args.plan ?? null,
      cross_session: crossSession,
    })
    .then(() => {}, () => {});
}
