// Hybrid rerank v2 — four-signal linear fusion with a per-memory `why` trace.
//
// Signals (all normalized to [0, 1] within the candidate pool so weights are
// comparable across queries):
//   bm25       : term-frequency relevance from ts_rank
//   vec        : pgvector cosine similarity, already in [0, 1]
//   recency    : exp(-age / half_life)
//   centrality : precomputed personalized PageRank on memory_edges
//
// Weights come from spine_rerank_weights (active row for the user, else the
// global default). If a training run has produced better weights we use them;
// otherwise the hand-tuned priors in migration 014 ship sensible results.
//
// Every candidate carries its per-signal score plus the signal that dominated
// its final score. The /api/spine/search response exposes this verbatim.

import { embedText } from './openai';
import { embedWithThread, type Turn } from './thread-embed';
import { getSupabase } from './supabase';

export type SignalName = 'bm25' | 'vec' | 'recency' | 'centrality';

export type WhyTrace = {
  bm25: number;
  vec: number;
  recency: number;
  centrality: number;
  final: number;
  dominant: SignalName;
};

export type RankedCandidate = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  lastConfirmedAt: string | null;
  supersededBy: string | null;
  why: WhyTrace;
};

export type Weights = {
  bm25_w: number;
  vec_w: number;
  recency_w: number;
  centrality_w: number;
  bias: number;
  model_version: string;
  training_n: number;
};

const DEFAULT_WEIGHTS: Weights = {
  bm25_w: 0.25,
  vec_w: 0.55,
  recency_w: 0.1,
  centrality_w: 0.1,
  bias: 0,
  model_version: 'default-v1',
  training_n: 0,
};

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  last_confirmed_at: string | null;
  superseded_by: string | null;
  centrality: number;
  vec_similarity: number;
  bm25_rank: number;
};

export type RerankV2Options = {
  poolLimit?: number;
  limit?: number;
  halfLifeDays?: number;
  supersededWeight?: number;
  threadTurns?: Turn[];
};

export async function loadWeights(userId: string | null): Promise<Weights> {
  const supabase = getSupabase();
  if (!supabase) return DEFAULT_WEIGHTS;

  // Prefer user-specific active row; fall back to global active; fall back to default.
  if (userId) {
    const { data: userRow } = await supabase
      .from('spine_rerank_weights')
      .select('bm25_w, vec_w, recency_w, centrality_w, bias, model_version, training_n')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (userRow) return userRow as Weights;
  }

  const { data: globalRow } = await supabase
    .from('spine_rerank_weights')
    .select('bm25_w, vec_w, recency_w, centrality_w, bias, model_version, training_n')
    .is('user_id', null)
    .eq('is_active', true)
    .maybeSingle();
  if (globalRow) return globalRow as Weights;

  return DEFAULT_WEIGHTS;
}

function normaliseMaxDiv(values: number[]): number[] {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => (v > 0 ? v / max : 0));
}

function dominantSignal(contrib: Record<SignalName, number>): SignalName {
  let best: SignalName = 'vec';
  let bestVal = -Infinity;
  (Object.keys(contrib) as SignalName[]).forEach((k) => {
    if (contrib[k] > bestVal) {
      bestVal = contrib[k];
      best = k;
    }
  });
  return best;
}

export async function rankMemoriesV2(
  userId: string,
  query: string,
  opts: RerankV2Options = {}
): Promise<{
  candidates: RankedCandidate[];
  weights: Weights;
  poolSize: number;
}> {
  const poolLimit = opts.poolLimit ?? 40;
  const limit = opts.limit ?? 20;
  const halfLife = opts.halfLifeDays ?? 90;
  const supersededWeight = Math.max(0, Math.min(1, opts.supersededWeight ?? 0.3));

  const supabase = getSupabase();
  if (!supabase) throw new Error('Server not configured for retrieval.');

  const [weights, queryEmbedding] = await Promise.all([
    loadWeights(userId),
    opts.threadTurns && opts.threadTurns.length > 0
      ? embedWithThread({ query, turns: opts.threadTurns })
      : embedText(query),
  ]);

  const { data, error } = await supabase.rpc('spine_hybrid_candidates_v3', {
    p_user: userId,
    p_query: query,
    p_query_embedding: queryEmbedding,
    p_limit: poolLimit,
  });
  if (error) throw new Error(`spine_hybrid_candidates_v3: ${error.message}`);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return { candidates: [], weights, poolSize: 0 };
  }

  const now = Date.now();
  const tau = halfLife / Math.LN2;

  // Raw signals per candidate
  const rawBm25 = rows.map((r) => r.bm25_rank);
  const rawVec = rows.map((r) => Math.max(0, Math.min(1, r.vec_similarity)));
  const rawRecency = rows.map((r) => {
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    return Math.exp(-ageDays / tau);
  });
  const rawCentrality = rows.map((r) => Math.max(0, r.centrality));

  // Pool-local normalisation so weights are unit-comparable.
  const bm25N = normaliseMaxDiv(rawBm25);
  const vecN = rawVec; // already [0, 1]
  const recencyN = rawRecency; // already [0, 1]
  const centralityN = normaliseMaxDiv(rawCentrality);

  const ranked: RankedCandidate[] = rows.map((r, i) => {
    const contrib = {
      bm25: weights.bm25_w * bm25N[i],
      vec: weights.vec_w * vecN[i],
      recency: weights.recency_w * recencyN[i],
      centrality: weights.centrality_w * centralityN[i],
    } as Record<SignalName, number>;

    const penalty = r.superseded_by ? supersededWeight : 1.0;
    const sum =
      (contrib.bm25 + contrib.vec + contrib.recency + contrib.centrality + weights.bias) * penalty;

    const final = Math.max(0, Math.min(1, sum));

    const why: WhyTrace = {
      bm25: round(bm25N[i]),
      vec: round(vecN[i]),
      recency: round(recencyN[i]),
      centrality: round(centralityN[i]),
      final: round(final),
      dominant: dominantSignal(contrib),
    };

    return {
      id: r.id,
      content: r.content,
      source: r.source,
      tags: r.tags ?? [],
      createdAt: r.created_at,
      lastConfirmedAt: r.last_confirmed_at,
      supersededBy: r.superseded_by,
      why,
    };
  });

  ranked.sort((a, b) => b.why.final - a.why.final);

  return {
    candidates: ranked.slice(0, limit),
    weights,
    poolSize: rows.length,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
