// POST /api/search
// Session-authenticated semantic search for the dashboard /search page.
// Uses the same hybrid retrieval as /api/recall but authenticates via
// Supabase session cookies (not API key) so the browser can call it directly.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { embedText } from '@/lib/openai';
import { PLAN_LIMITS } from '@/lib/plan-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MemoryHit {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
}

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: { query?: unknown; limit?: unknown; source?: unknown; tags?: unknown };
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

  // Get plan from profile
  const { data: profile } = await sb
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();
  const plan = (profile?.plan as string | undefined) ?? 'free';
  const isPro = plan === 'pro' || plan === 'team';

  // Embed query
  let embedding: number[];
  try {
    embedding = await embedText(query);
  } catch {
    return NextResponse.json({ error: 'Embedding failed — check OPENAI_API_KEY.' }, { status: 500 });
  }

  // Run vector search via RPC
  const rpcLimit = isPro ? Math.min(limit * 3, 60) : Math.min(limit, 10);
  const { data: rawHits, error: rpcErr } = await sb.rpc('spine_match_memories', {
    p_user: user.id,
    p_query_embedding: embedding,
    p_limit: rpcLimit,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  let hits: MemoryHit[] = (rawHits ?? []).map((r: {
    id: string; content: string; source: string | null; tags: string[] | null;
    created_at: string; similarity: number;
  }) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags,
    created_at: r.created_at,
    similarity: r.similarity,
  }));

  // Apply source / tag filters
  if (sourceFilter) {
    hits = hits.filter((h) => h.source === sourceFilter);
  }
  if (tagsFilter) {
    hits = hits.filter((h) => h.tags && tagsFilter.some((t) => h.tags!.includes(t)));
  }

  // Trim to requested limit
  hits = hits.slice(0, limit);

  // Background touch
  if (hits.length > 0) {
    void sb.rpc('spine_touch_retrieved', { p_user: user.id, p_ids: hits.map((h) => h.id) }).then(
      () => void 0,
      () => void 0,
    );
  }

  return NextResponse.json({
    memories: hits,
    query,
    plan,
    total: hits.length,
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
