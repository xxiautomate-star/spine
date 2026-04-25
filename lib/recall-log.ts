// Full query + per-candidate recall log.
//
// Every /api/search and /api/spine/search hit calls logRecall(). We persist:
//   - one saas_spine_recall_queries row per query
//   - one saas_spine_recall_candidates row per candidate in the pool (not just
//     the top-K returned), so the trainer has counterfactual "what we had but
//     did not show" examples to learn from.
//
// Fire-and-forget. Never blocks the response.

import { createHash } from 'node:crypto';
import { getSupabase } from './supabase';
import type { Weights } from './rerank-v2';
import type { WhyTrace, RankedCandidate } from './rerank-v2';

export type LoggedCandidate = RankedCandidate & {
  crossEncoderScore?: number | null;
  rankShown?: number | null;
};

export type RecallLogArgs = {
  userId: string | null;
  sessionId: string | null;
  isDemo: boolean;
  query: string;
  poolSize: number;
  topK: number;
  shownIds: string[];
  provider: string | null;
  weights: Weights;
  latencyMs: number;
  candidates: LoggedCandidate[];
};

function queryHash(q: string) {
  return createHash('sha256').update(q.trim().toLowerCase()).digest('hex');
}

export function logRecall(args: RecallLogArgs): void {
  const supabase = getSupabase();
  if (!supabase) return;

  const shownLookup = new Map<string, number>();
  args.shownIds.forEach((id, i) => shownLookup.set(id, i + 1));

  void (async () => {
    try {
      const { data: qRow, error: qErr } = await supabase
        .from('saas_spine_recall_queries')
        .insert({
          user_id: args.userId,
          session_id: args.sessionId,
          is_demo: args.isDemo,
          query: args.query.slice(0, 1000),
          query_hash: queryHash(args.query),
          pool_size: args.poolSize,
          top_k: args.topK,
          shown_ids: args.shownIds,
          provider: args.provider,
          weights_snap: args.weights,
          latency_ms: args.latencyMs,
        })
        .select('id')
        .single();

      if (qErr || !qRow) return;

      const rows = args.candidates.map((c) => ({
        query_id: qRow.id as string,
        memory_id: c.id,
        content_preview: c.content.slice(0, 160),
        rank_shown: shownLookup.get(c.id) ?? null,
        why_bm25: c.why.bm25,
        why_vec: c.why.vec,
        why_recency: c.why.recency,
        why_centrality: c.why.centrality,
        why_final: c.why.final,
        dominant: c.why.dominant,
        cross_encoder_score: c.crossEncoderScore ?? null,
      }));

      if (rows.length > 0) {
        await supabase.from('saas_spine_recall_candidates').insert(rows);
      }
    } catch {
      // Telemetry must never throw.
    }
  })();
}

export function emptyWhy(): WhyTrace {
  return { bm25: 0, vec: 0, recency: 0, centrality: 0, final: 0, dominant: 'vec' };
}
