// POST /api/search
// Session-authenticated semantic search for the dashboard /search page.
// Round 18: upgraded to v2 ranker (4-signal fusion + cross-encoder). Every
// hit carries a why trace: {bm25, vec, recency, centrality, final, dominant}.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { rankMemoriesV2 } from '@/lib/rerank-v2';
import { crossEncoderRerank } from '@/lib/cross-encoder';
import { logRecall, type LoggedCandidate } from '@/lib/recall-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: { query?: unknown; limit?: unknown; source?: unknown; tags?: unknown; skip_rerank?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (typeof body.query !== 'string' || !body.query.trim()) {
    return NextResponse.json({ error: 'query is required.' }, { status: 400 });
  }

  const query = body.query.trim();
  const limit = typeof body.limit === 'number' ? Math.min(50, Math.max(1, body.limit)) : 20;
  const sourceFilter = typeof body.source === 'string' && body.source ? body.source : null;
  const tagsFilter = Array.isArray(body.tags) && body.tags.length > 0
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : null;

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data: profile } = await sb
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();
  const plan = (profile?.plan as string | undefined) ?? 'free';

  let ranked;
  try {
    ranked = await rankMemoriesV2(user.id, query, {
      poolLimit: Math.min(limit * 3, 60),
      limit: Math.min(limit * 2, 50),
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Search failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 }
    );
  }

  let working = ranked.candidates;
  if (sourceFilter) working = working.filter((c) => c.source === sourceFilter);
  if (tagsFilter) {
    working = working.filter((c) => c.tags && tagsFilter.some((t) => c.tags.includes(t)));
  }

  let rerankProvider: string | null = null;
  if (!body.skip_rerank && working.length > 1) {
    try {
      const rr = await crossEncoderRerank(
        query,
        working.slice(0, 20).map((c) => ({
          id: c.id,
          content: c.content,
          source: c.source,
          createdAt: c.createdAt,
        })),
        { limit: Math.min(limit, 20) }
      );
      rerankProvider = rr.provider;
      const scoreById = new Map(rr.picks.map((p) => [p.id, p.score]));
      working = working.map((c) => {
        const x = scoreById.get(c.id);
        if (x === undefined) return c;
        return { ...c, why: { ...c.why, final: x } };
      });
      working.sort((a, b) => b.why.final - a.why.final);
    } catch {
      // fall through — fused-only order is still good
    }
  }

  const hits = working.slice(0, limit).map((c) => ({
    id: c.id,
    content: c.content,
    source: c.source,
    tags: c.tags,
    created_at: c.createdAt,
    fused_score: c.why.final,
    why: c.why,
  }));

  if (hits.length > 0) {
    void sb
      .rpc('spine_touch_retrieved', { p_user: user.id, p_ids: hits.map((h) => h.id) })
      .then(() => void 0, () => void 0);
  }

  // Per-candidate recall log. Uses fullPool so the trainer sees beaten candidates.
  const logged: LoggedCandidate[] = (ranked.fullPool ?? ranked.candidates).map((c) => ({
    ...c,
    crossEncoderScore: null,
  }));

  logRecall({
    userId: user.id,
    sessionId: req.headers.get('x-spine-session') ?? null,
    isDemo: false,
    query,
    poolSize: ranked.poolSize,
    topK: limit,
    shownIds: hits.map((h) => h.id),
    provider: rerankProvider,
    weights: ranked.weights,
    latencyMs: 0, // not tracked at this call site; recall-telemetry already logs end-to-end
    candidates: logged,
  });

  return NextResponse.json({
    memories: hits,
    query,
    plan,
    total: hits.length,
    weights: ranked.weights,
    rerank_provider: rerankProvider,
  });
}

// GET /api/search/sources — return distinct sources for filter dropdown
export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data } = await sb
    .from('memories')
    .select('source, tags')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('source', 'is', null)
    .limit(500);

  const sources = [...new Set((data ?? []).map((r) => r.source as string).filter(Boolean))].sort();
  const allTags = [...new Set(
    (data ?? []).flatMap((r) => (r.tags as string[] | null) ?? []).filter(Boolean)
  )].sort();

  return NextResponse.json({ sources, tags: allTags });
}
