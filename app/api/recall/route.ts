import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { rankMemories } from '@/lib/retrieval';
import { crossEncoderRerank } from '@/lib/cross-encoder';
import { buildInjectionBlock } from '@/lib/context-block';
import { touchRetrieved } from '@/lib/retrieval-touch';
import { logRecallEvent } from '@/lib/recall-telemetry';
import { fetchPriorInjections, applyDedup, logInjections } from '@/lib/session-dedup';
import type { Turn } from '@/lib/thread-embed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecallBody = {
  query?: unknown;
  limit?: unknown;
  include_block?: unknown;
  session_id?: unknown;
  thread_turns?: unknown;
};

function parseThreadTurns(raw: unknown): Turn[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Turn[] = [];
  for (const t of raw.slice(-3)) {
    if (!t || typeof t !== 'object') continue;
    const role = (t as { role?: string }).role;
    const text = (t as { text?: string }).text;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (!trimmed) continue;
    out.push({ role, text: trimmed.slice(0, 1000) });
  }
  return out.length > 0 ? out : undefined;
}

function parseSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return trimmed;
}

async function freeRecall(
  userId: string,
  query: string,
  limit: number,
  includeBlock: boolean,
  sessionId: string | null,
  threadTurns: Turn[] | undefined
) {
  const t0 = Date.now();
  const candidates = await rankMemories(userId, query, {
    poolLimit: limit * 3,
    limit: limit * 3,
    threadTurns,
  });

  const priors = sessionId
    ? await fetchPriorInjections(userId, sessionId)
    : new Map();
  const deduped = applyDedup(candidates, priors).slice(0, limit);

  const memories = deduped.map((c) => ({
    id: c.id,
    content: c.content,
    source: c.source,
    tags: c.tags,
    createdAt: c.createdAt,
    lastConfirmedAt: c.lastConfirmedAt,
    supersededBy: c.supersededBy,
    similarity: c.vecSimilarity,
    fusedScore: c.fusedScore,
  }));

  touchRetrieved(userId, memories.map((m) => m.id));
  if (sessionId) {
    logInjections({ userId, sessionId, memories });
  }
  logRecallEvent({
    userId,
    isDemo: false,
    queryLen: query.length,
    hits: memories.map((m) => ({ id: m.id, createdAt: m.createdAt })),
    latencyMs: Date.now() - t0,
    plan: 'free',
  });

  const block = includeBlock
    ? buildInjectionBlock(
        memories.map((m) => ({
          id: m.id,
          content: m.content,
          source: m.source,
          createdAt: m.createdAt,
          lastConfirmedAt: m.lastConfirmedAt,
          supersededBy: m.supersededBy,
        })),
        { query }
      )
    : undefined;

  return {
    memories,
    ...(includeBlock ? { block } : {}),
    plan: 'free' as const,
    rerank_cost_usd: 0,
    rerank_provider: null,
    deduped_ids: priors.size,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: RecallBody;
  try {
    body = (await req.json()) as RecallBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });
  const requested = typeof body.limit === 'number' ? body.limit : 5;
  const limit = Math.max(1, Math.min(20, Math.floor(requested)));
  const includeBlock = body.include_block === true;
  const sessionId = parseSessionId(body.session_id);
  const threadTurns = parseThreadTurns(body.thread_turns);

  if (auth.authed.plan === 'free') {
    try {
      const result = await freeRecall(
        auth.authed.userId,
        query,
        limit,
        includeBlock,
        sessionId,
        threadTurns
      );
      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Recall failed.' },
        { status: 500 }
      );
    }
  }

  // Pro / Power: full hybrid + thread-blend + cross-encoder rerank + session dedup.
  const t0 = Date.now();
  try {
    const candidates = await rankMemories(auth.authed.userId, query, {
      poolLimit: 20,
      limit: 20,
      threadTurns,
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        memories: [],
        block: includeBlock ? '' : undefined,
        plan: auth.authed.plan,
        rerank_cost_usd: 0,
        rerank_provider: null,
        deduped_ids: 0,
      });
    }

    const priors = sessionId
      ? await fetchPriorInjections(auth.authed.userId, sessionId)
      : new Map();
    const afterDedup = applyDedup(candidates, priors);
    // If dedup wiped everything, fall back to the raw candidates — better to
    // re-inject a known-good memory than to return nothing.
    const rerankPool = afterDedup.length > 0 ? afterDedup : candidates;

    type Pick = { id: string; score: number; reason?: string };
    let picks: Pick[] = [];
    let rerankCost = 0;
    let rerankProvider: 'cohere' | 'jina' | 'haiku' | null = null;

    try {
      const result = await crossEncoderRerank(query, rerankPool, { limit });
      if (result.picks.length > 0) {
        picks = result.picks;
        rerankCost = result.cost;
        rerankProvider = result.provider;
      }
    } catch {
      // fall through to fused-only
    }

    if (picks.length === 0) {
      picks = rerankPool.slice(0, limit).map((c) => ({ id: c.id, score: c.fusedScore }));
    }

    const byId = new Map(rerankPool.map((c) => [c.id, c]));
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
          lastConfirmedAt: c.lastConfirmedAt,
          supersededBy: c.supersededBy,
          similarity: c.vecSimilarity,
          score: p.score,
          reason: p.reason,
          fusedScore: c.fusedScore,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    touchRetrieved(auth.authed.userId, memories.map((m) => m.id));
    if (sessionId) {
      logInjections({ userId: auth.authed.userId, sessionId, memories });
    }
    logRecallEvent({
      userId: auth.authed.userId,
      isDemo: false,
      queryLen: query.length,
      hits: memories.map((m) => ({ id: m.id, createdAt: m.createdAt })),
      latencyMs: Date.now() - t0,
      rerankCostUsd: rerankCost,
      plan: auth.authed.plan,
    });

    const block = includeBlock
      ? buildInjectionBlock(
          memories.map((m) => ({
            id: m.id,
            content: m.content,
            source: m.source,
            createdAt: m.createdAt,
            lastConfirmedAt: m.lastConfirmedAt,
            supersededBy: m.supersededBy,
          })),
          { query }
        )
      : undefined;

    return NextResponse.json({
      memories,
      ...(includeBlock ? { block } : {}),
      plan: auth.authed.plan,
      rerank_cost_usd: rerankCost,
      rerank_provider: rerankProvider,
      deduped_ids: priors.size,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recall failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
