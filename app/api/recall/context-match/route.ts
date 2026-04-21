// POST /api/recall/context-match
// Extension polls this endpoint while user is typing to find past captures
// that match the current query. Returns the best match above threshold.
// Auth: API key (same as /api/capture).
// Designed for <100ms on cache hits.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { findContextMatch } from '@/lib/cross-session-linker';
import { withCors, preflight } from '@/lib/cors';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  let query: string;
  try {
    const body = (await req.json()) as { query?: unknown };
    if (typeof body.query !== 'string' || !body.query.trim()) {
      return withCors(NextResponse.json({ error: 'query string required.' }, { status: 400 }));
    }
    query = body.query;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }));
  }

  try {
    const sb = getSupabase();
    const result = await findContextMatch(auth.authed.userId, query);

    // Unresolved conflict count — drives the red badge in the extension.
    let conflictCount = 0;
    if (sb) {
      const { count } = await sb
        .from('memory_conflicts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.authed.userId)
        .is('resolution', null);
      conflictCount = count ?? 0;
    }

    // Required-context memories — inject regardless of cosine score.
    let requiredMemories: { id: string; content: string }[] = [];
    if (sb) {
      const { data: req_mems } = await sb
        .from('memories')
        .select('id, content')
        .eq('user_id', auth.authed.userId)
        .eq('required_context', true)
        .is('deleted_at', null)
        .is('archived_at', null)
        .limit(10);
      requiredMemories = (req_mems as { id: string; content: string }[]) ?? [];
    }

    return withCors(NextResponse.json({ ...result, conflictCount, requiredMemories }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Match failed.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
