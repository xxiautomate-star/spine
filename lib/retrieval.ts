import { embedText } from './openai';
import { getSupabase } from './supabase';

export type Candidate = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  vecSimilarity: number;
  bm25Rank: number;
  vecRankPos: number; // 0 = not in top-N by vector
  bm25RankPos: number; // 0 = not in top-N by BM25
  rrfScore: number;
  ageDays: number;
  decay: number;
  fusedScore: number;
};

export type RankOptions = {
  /** Number of candidates to pull from each side before fusion. Default 15. */
  poolLimit?: number;
  /** Final candidates to return after fusion. Default 15. */
  limit?: number;
  /** RRF constant. Default 60. */
  rrfK?: number;
  /** Temporal decay half-life in days. Default 90. */
  decayHalfLifeDays?: number;
};

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  vec_similarity: number;
  bm25_rank: number;
};

export async function rankMemories(
  userId: string,
  query: string,
  opts: RankOptions = {}
): Promise<Candidate[]> {
  const poolLimit = opts.poolLimit ?? 15;
  const limit = opts.limit ?? 15;
  const rrfK = opts.rrfK ?? 60;
  const halfLife = opts.decayHalfLifeDays ?? 90;

  const supabase = getSupabase();
  if (!supabase) throw new Error('Server not configured for retrieval.');

  const embedding = await embedText(query);

  const { data, error } = await supabase.rpc('spine_hybrid_candidates', {
    p_user: userId,
    p_query: query,
    p_query_embedding: embedding,
    p_limit: poolLimit,
  });
  if (error) throw new Error(`spine_hybrid_candidates: ${error.message}`);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  // Rank positions per signal (1-indexed; 0 = not present in that pool).
  const vecOrder = [...rows]
    .filter((r) => r.vec_similarity > 0)
    .sort((a, b) => b.vec_similarity - a.vec_similarity);
  const bm25Order = [...rows]
    .filter((r) => r.bm25_rank > 0)
    .sort((a, b) => b.bm25_rank - a.bm25_rank);

  const vecPos = new Map<string, number>();
  vecOrder.forEach((r, i) => vecPos.set(r.id, i + 1));
  const bm25Pos = new Map<string, number>();
  bm25Order.forEach((r, i) => bm25Pos.set(r.id, i + 1));

  const now = Date.now();
  const decayTau = halfLife / Math.LN2; // tau such that e^(-t/tau) at t=halfLife = 0.5

  const candidates: Candidate[] = rows.map((r) => {
    const vp = vecPos.get(r.id) ?? 0;
    const bp = bm25Pos.get(r.id) ?? 0;
    const rrf =
      (vp > 0 ? 1 / (rrfK + vp) : 0) + (bp > 0 ? 1 / (rrfK + bp) : 0);
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const decay = Math.exp(-ageDays / decayTau);
    return {
      id: r.id,
      content: r.content,
      source: r.source,
      tags: r.tags ?? [],
      createdAt: r.created_at,
      vecSimilarity: r.vec_similarity,
      bm25Rank: r.bm25_rank,
      vecRankPos: vp,
      bm25RankPos: bp,
      rrfScore: rrf,
      ageDays,
      decay,
      fusedScore: rrf * decay,
    };
  });

  candidates.sort((a, b) => b.fusedScore - a.fusedScore);
  const top = candidates.slice(0, limit);

  // Graph expansion: walk memory_edges from top-10 to surface related chunks
  // that BM25+vector both missed. Weight-discounted to 0.6× of the linking
  // chunk's fusedScore so they appear below direct matches.
  try {
    const seedIds = top.slice(0, 10).map((c) => c.id);
    const alreadyIn = new Set(top.map((c) => c.id));

    const { data: neighbors } = await supabase.rpc('memory_graph_neighbors', {
      p_user: userId,
      p_seed_ids: seedIds,
      p_limit: 10,
    });

    if (neighbors && neighbors.length > 0) {
      for (const n of neighbors as Array<{
        id: string; content: string; source: string | null;
        tags: string[] | null; created_at: string;
        relationship_type: string; entity_name: string | null; weight: number;
      }>) {
        if (alreadyIn.has(n.id)) continue;

        // Inherit fusedScore from the highest-scoring seed that linked to it,
        // then discount by 0.6 and edge weight (capped at 2.0 for normalisation).
        const edgeBoost = Math.min(n.weight / 2.0, 1.0);
        const parentScore = top[0]?.fusedScore ?? 0.1;
        const ageDays = (now - new Date(n.created_at).getTime()) / 86_400_000;
        const decay = Math.exp(-ageDays / decayTau);

        top.push({
          id: n.id,
          content: n.content,
          source: n.source,
          tags: n.tags ?? [],
          createdAt: n.created_at,
          vecSimilarity: 0,
          bm25Rank: 0,
          vecRankPos: 0,
          bm25RankPos: 0,
          rrfScore: 0,
          ageDays,
          decay,
          fusedScore: parentScore * 0.6 * edgeBoost * decay,
        });
        alreadyIn.add(n.id);
      }

      top.sort((a, b) => b.fusedScore - a.fusedScore);
    }
  } catch {
    // graph expansion is best-effort — never fail the primary recall
  }

  return top.slice(0, limit);
}
