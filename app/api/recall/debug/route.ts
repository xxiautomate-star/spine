// Session-authenticated debug endpoint for /dashboard/recall. Returns the
// full retrieval pipeline breakdown (candidates + picks + block + cost).

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { rankMemories, type Candidate } from '@/lib/retrieval';
import { rerank } from '@/lib/rerank';
import { buildInjectionBlock } from '@/lib/context-block';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: { query?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });
  const requested = typeof body.limit === 'number' ? body.limit : 5;
  const limit = Math.max(1, Math.min(20, Math.floor(requested)));

  const t0 = Date.now();
  let candidates: Candidate[] = [];
  try {
    candidates = await rankMemories(user.id, query, { poolLimit: 30, limit: 30 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Retrieval failed.' },
      { status: 500 }
    );
  }
  const t1 = Date.now();

  let picks: Array<{ id: string; score: number; reason: string }> = [];
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let rerankLatency = 0;
  let rerankError: string | null = null;
  let rawText = '';

  if (candidates.length > 0) {
    try {
      const result = await rerank(query, candidates, { limit });
      picks = result.picks;
      cost = result.cost;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      cacheReadTokens = result.cacheReadTokens;
      cacheWriteTokens = result.cacheWriteTokens;
      rerankLatency = result.latencyMs;
      rawText = result.rawText;
    } catch (err) {
      rerankError = err instanceof Error ? err.message : 'Rerank failed.';
    }
  }
  const t2 = Date.now();

  // Fallback to fused order when rerank is unavailable.
  const effectivePicks =
    picks.length > 0
      ? picks
      : candidates.slice(0, limit).map((c) => ({
          id: c.id,
          score: c.fusedScore,
          reason: 'fused-only (rerank unavailable)',
        }));

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const finalMemories = effectivePicks
    .map((p) => {
      const c = byId.get(p.id);
      if (!c) return null;
      return { pick: p, memory: c };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const block = buildInjectionBlock(
    finalMemories.map((f) => ({
      id: f.memory.id,
      content: f.memory.content,
      source: f.memory.source,
      createdAt: f.memory.createdAt,
    })),
    { query }
  );

  return NextResponse.json({
    query,
    candidates,
    picks: effectivePicks,
    final: finalMemories,
    block,
    timings: {
      retrieval_ms: t1 - t0,
      rerank_ms: t2 - t1,
      total_ms: t2 - t0,
      rerank_latency_ms: rerankLatency,
    },
    cost_usd: cost,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cache_read: cacheReadTokens,
      cache_write: cacheWriteTokens,
    },
    rerank_error: rerankError,
    raw_text: rawText,
  });
}
