import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { rankMemories } from '@/lib/retrieval';
import { checkAndCount, SOFT_THROTTLE_DELAY_SECONDS } from '@/lib/recall-rate-limit';
import { crossEncoderRerank } from '@/lib/cross-encoder';
import { buildInjectionBlock } from '@/lib/context-block';
import { touchRetrieved } from '@/lib/retrieval-touch';
import { logRecallEvent } from '@/lib/recall-telemetry';
import { fetchPriorInjections, applyDedup, logInjections } from '@/lib/session-dedup';
import type { Turn } from '@/lib/thread-embed';
import { logAuditBatchFireForget, type AuditEntry } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RecallBody = {
  query?: unknown;
  limit?: unknown;
  include_block?: unknown;
  session_id?: unknown;
  thread_turns?: unknown;
  // Brief 023 — power-user flag. When true, the recall response also
  // includes low-signal rows matched via BM25 only (their embedding is null
  // so they're invisible to the default semantic path). Marked with
  // `filtered_match: true` in the result so callers can render them
  // distinctly. Default: false.
  include_filtered?: unknown;
};

type FilteredHit = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  signalTier: 'low';
  filtered_match: true;
};

async function fetchFilteredMatches(
  userId: string,
  query: string,
  limit: number
): Promise<FilteredHit[]> {
  const { getSupabase } = await import('@/lib/supabase');
  const sb = getSupabase();
  if (!sb) return [];
  const safeQuery = query.trim().slice(0, 500);
  if (!safeQuery) return [];
  // FTS over content_tsv (already-indexed, GIN) for low-signal rows. We
  // explicitly filter by user_id because the bearer-auth route uses the
  // service-role client (RLS bypassed). Supabase's textSearch builds a
  // websearch_to_tsquery — "spine.xxiautomate.com" or "deploy failed"
  // both work without hand-tokenizing.
  const { data, error } = await sb
    .from('memories')
    .select('id, content, source, tags, created_at')
    .eq('user_id', userId)
    .eq('signal_tier', 'low')
    .is('deleted_at', null)
    .textSearch('content_tsv', safeQuery, { type: 'websearch' })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{
    id: string;
    content: string;
    source: string | null;
    tags: string[] | null;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    signalTier: 'low',
    filtered_match: true,
  }));
}

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
  keyId: string,
  orgId: string | null,
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
  // Cross-cut audit: one row per recalled memory + one row marking the query
  // itself. Lets the dashboard answer both "which queries hit memory X?" and
  // "what did this API key recall today?".
  const auditRows: AuditEntry[] = memories.map((m) => ({
    userId,
    orgId,
    op: 'read',
    memoryId: m.id,
    query,
    caller: keyId,
    metadata: { plan: 'free', session_id: sessionId },
  }));
  auditRows.push({
    userId,
    orgId,
    op: 'read',
    query,
    caller: keyId,
    metadata: { plan: 'free', session_id: sessionId, hit_count: memories.length },
  });
  logAuditBatchFireForget(auditRows);

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

  // Daily recall rate limit (Gate B). Always increments — over-limit
  // calls 429 with Retry-After until UTC midnight, soft-limit calls
  // proceed but carry an advisory header so cooperative clients back off.
  const verdict = await checkAndCount(auth.authed.userId, auth.authed.plan);
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: `Daily recall cap reached: ${verdict.limit} recalls/day on ${auth.authed.plan}. Resets at UTC midnight.`,
        error_code: 'recall_rate_limit',
        plan: auth.authed.plan,
        count: verdict.count,
        limit: verdict.limit,
        retry_after_seconds: verdict.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(verdict.retryAfterSeconds),
          'X-Spine-Recall-Count': String(verdict.count),
          'X-Spine-Recall-Limit': String(verdict.limit),
        },
      }
    );
  }
  const requested = typeof body.limit === 'number' ? body.limit : 5;
  const limit = Math.max(1, Math.min(20, Math.floor(requested)));
  const includeBlock = body.include_block === true;
  const includeFiltered = body.include_filtered === true;
  const sessionId = parseSessionId(body.session_id);
  const threadTurns = parseThreadTurns(body.thread_turns);

  // Run the filtered-match (low-signal BM25) query in parallel with the
  // main rank when the flag is set. Cheap — single GIN-indexed query.
  const filteredPromise: Promise<FilteredHit[]> = includeFiltered
    ? fetchFilteredMatches(auth.authed.userId, query, Math.min(limit, 10))
    : Promise.resolve([]);

  if (auth.authed.plan === 'free') {
    try {
      const result = await freeRecall(
        auth.authed.userId,
        auth.authed.keyId,
        auth.authed.orgId ?? null,
        query,
        limit,
        includeBlock,
        sessionId,
        threadTurns
      );
      const filtered = await filteredPromise;
      return NextResponse.json(
        filtered.length > 0 ? { ...result, filtered_matches: filtered } : result
      );
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
      const filtered = await filteredPromise;
      return NextResponse.json({
        memories: [],
        block: includeBlock ? '' : undefined,
        plan: auth.authed.plan,
        rerank_cost_usd: 0,
        rerank_provider: null,
        deduped_ids: 0,
        ...(filtered.length > 0 ? { filtered_matches: filtered } : {}),
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
    let rerankProvider: 'together' | 'cohere' | 'jina' | 'haiku' | null = null;

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
    const paidUserId = auth.authed.userId;
    const paidKeyId = auth.authed.keyId;
    const paidOrgId = auth.authed.orgId ?? null;
    const paidPlan = auth.authed.plan;
    const paidAuditRows: AuditEntry[] = memories.map((m) => ({
      userId: paidUserId,
      orgId: paidOrgId,
      op: 'read',
      memoryId: m.id,
      query,
      caller: paidKeyId,
      metadata: { plan: paidPlan, session_id: sessionId, rerank_provider: rerankProvider },
    }));
    paidAuditRows.push({
      userId: paidUserId,
      orgId: paidOrgId,
      op: 'read',
      query,
      caller: paidKeyId,
      metadata: {
        plan: paidPlan,
        session_id: sessionId,
        rerank_provider: rerankProvider,
        hit_count: memories.length,
        rerank_cost_usd: rerankCost,
      },
    });
    logAuditBatchFireForget(paidAuditRows);

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

    const filtered = await filteredPromise;
    return NextResponse.json({
      memories,
      ...(includeBlock ? { block } : {}),
      ...(filtered.length > 0 ? { filtered_matches: filtered } : {}),
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
