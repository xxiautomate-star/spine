// POST /api/recall/context-match
// Extension polls this endpoint while user is typing to find past captures
// that match the current query. Returns the best match above threshold.
// Auth: API key (same as /api/capture).
// Designed for <100ms on cache hits.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { findContextMatch } from '@/lib/cross-session-linker';
import { withCors, preflight } from '@/lib/cors';

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
    const result = await findContextMatch(auth.authed.userId, query);
    return withCors(NextResponse.json(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Match failed.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
}
