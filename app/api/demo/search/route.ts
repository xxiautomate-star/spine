import { NextResponse, type NextRequest } from 'next/server';
import { embedText } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { logRecallEvent } from '@/lib/recall-telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

type MatchRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
};

export async function GET(req: NextRequest) {
  const demoUserId = process.env.SPINE_DEMO_USER_ID;
  const supabase = getSupabase();

  if (!demoUserId || !supabase) {
    return withCors(
      NextResponse.json({ error: 'Demo not configured. Set SPINE_DEMO_USER_ID and Supabase env vars.' }, { status: 503 })
    );
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10)));

  const t0 = Date.now();
  let data: MatchRow[] | null = null;
  let error: { message: string } | null = null;

  if (query.length > 0) {
    let vec: number[];
    try {
      vec = await embedText(query);
    } catch (e) {
      return withCors(
        NextResponse.json({ error: 'Embedding failed. OPENAI_API_KEY may not be set.' }, { status: 503 })
      );
    }

    const result = await supabase.rpc('spine_match_memories', {
      p_user: demoUserId,
      p_query_embedding: vec,
      p_limit: limit,
    });
    data = result.data as MatchRow[] | null;
    error = result.error;
  } else {
    // No query — return newest memories for initial page load
    const result = await supabase
      .from('memories')
      .select('id, content, source, tags, created_at')
      .eq('user_id', demoUserId)
      .order('created_at', { ascending: false })
      .limit(limit);
    data = (result.data ?? []).map((r) => ({ ...r, similarity: 1 })) as MatchRow[];
    error = result.error;
  }

  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  const memories = ((data ?? []) as MatchRow[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source ?? 'claude.ai',
    tags: r.tags ?? [],
    createdAt: r.created_at,
    similarity: typeof r.similarity === 'number' ? r.similarity : 1,
  }));

  const latencyMs = Date.now() - t0;

  if (query.length > 0) {
    logRecallEvent({
      userId: null,
      isDemo: true,
      queryLen: query.length,
      hits: memories.map((m) => ({ id: m.id, createdAt: m.createdAt })),
      latencyMs,
      plan: 'demo',
    });
  }

  return withCors(
    NextResponse.json({ memories, query, total: memories.length, latency_ms: latencyMs })
  );
}
