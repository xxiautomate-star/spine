import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { rankMemories } from '@/lib/retrieval';
import { rerank } from '@/lib/rerank';
import { buildInjectionBlock } from '@/lib/context-block';
import { embedText } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { touchRetrieved } from '@/lib/retrieval-touch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MatchRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
};

async function freeRecall(
  userId: string,
  query: string,
  limit: number,
  includeBlock: boolean
) {
  const vec = await embedText(query);
  const supabase = getSupabase();
  if (!supabase) throw new Error('Server not configured.');
  const { data, error } = await supabase.rpc('spine_match_memories', {
    p_user: userId,
    p_query_embedding: vec,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  const memories = ((data ?? []) as MatchRow[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    similarity: r.similarity,
  }));

  touchRetrieved(userId, memories.map((m) => m.id));

  const block = includeBlock
    ? buildInjectionBlock(
        memories.map((m) => ({
          id: m.id,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt,
        })),
        { query }
      )
    : undefined;

  return { memories, ...(includeBlock ? { block } : {}), plan: 'free' as const, rerank_cost_usd: 0 };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { query?: unknown; limit?: unknown; include_block?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });
  const requested = typeof body.limit === 'number' ? body.limit : 5;
  const limit = Math.max(1, Math.min(20, Math.floor(requested)));
  const includeBlock = body.include_block === true;

  // Free tier: pure pgvector, no BM25, no Haiku rerank.
  if (auth.authed.plan === 'free') {
    try {
      const result = await freeRecall(auth.authed.userId, query, limit, includeBlock);
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Recall failed.' },
        { status: 500 }
      );
    }
  }

  // Pro / Power: full hybrid + Haiku rerank.
  try {
    const candidates = await rankMemories(auth.authed.userId, query, {
      poolLimit: 15,
      limit: 15,
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        memories: [],
        block: includeBlock ? '' : undefined,
        plan: auth.authed.plan,
        rerank_cost_usd: 0,
      });
    }

    type Pick = { id: string; score: number; reason?: string };
    let picks: Pick[] = [];
    let rerankCost = 0;

    try {
      const result = await rerank(query, candidates, { limit });
      if (result.picks.length > 0) {
        picks = result.picks;
        rerankCost = result.cost;
      }
    } catch {
      // fall through to fused-only
    }

    if (picks.length === 0) {
      picks = candidates.slice(0, limit).map((c) => ({ id: c.id, score: c.fusedScore }));
    }

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const memories = picks
      .map((p) => {
        const c = byId.get(p.id);
        if (!c) return null;
        return {
          id: c.id,
          content: c.content,
          source: c.source,
          tags: c.tags,
          createdAt: c.createdAt,
          similarity: c.vecSimilarity,
          score: p.score,
          reason: p.reason,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    touchRetrieved(auth.authed.userId, memories.map((m) => m.id));

    const block = includeBlock
      ? buildInjectionBlock(
          memories.map((m) => ({
            id: m.id,
            content: m.content,
            source: m.source,
            createdAt: m.createdAt,
          })),
          { query }
        )
      : undefined;

    return NextResponse.json({
      memories,
      ...(includeBlock ? { block } : {}),
      plan: auth.authed.plan,
      rerank_cost_usd: rerankCost,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recall failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
