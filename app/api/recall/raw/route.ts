// Raw pgvector-only recall path. No BM25, no rerank. Used for debugging the
// vector index directly. Authenticated via MCP Bearer key.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { embedText } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';

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

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { query?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return NextResponse.json({ error: 'query is required' }, { status: 400 });
  const requested = typeof body.limit === 'number' ? body.limit : 10;
  const limit = Math.max(1, Math.min(50, Math.floor(requested)));

  let vec: number[];
  try {
    vec = await embedText(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data, error } = await supabase.rpc('spine_match_memories', {
    p_user: auth.authed.userId,
    p_query_embedding: vec,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const memories = ((data ?? []) as MatchRow[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags ?? [],
    createdAt: r.created_at,
    similarity: r.similarity,
  }));
  return NextResponse.json({ memories });
}
