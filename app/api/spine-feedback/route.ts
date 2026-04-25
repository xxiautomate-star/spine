// Feedback endpoint — MCP + extension call this on every new user turn.
// We look back 10 minutes for recall queries in the same session, infer
// which shown memories the turn cited via n-gram overlap, and persist the
// labels that the nightly trainer reads.
//
// API-key authed for internal calls, optional for demo/session-cookie calls.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getServerUser } from '@/lib/supabase-server';
import { inferLabelsFromTurn } from '@/lib/label-inference';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (!checkRateLimit(clientIp(req))) {
    return NextResponse.json({ error: 'rate limit' }, { status: 429 });
  }

  let body: { session_id?: unknown; turn_text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const turnText = typeof body.turn_text === 'string' ? body.turn_text.trim() : '';
  if (!turnText) {
    return NextResponse.json({ error: 'turn_text is required' }, { status: 400 });
  }
  const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : null;

  // Authenticate via API key first; fall back to session cookie. Either gives
  // us a user id to scope the label inference.
  let userId: string | null = null;
  const apiAuth = await requireApiKey(req);
  if (apiAuth.authed) {
    userId = apiAuth.authed.userId;
  } else {
    const user = await getServerUser();
    if (user) userId = user.id;
  }

  // Bound the turn length — 4k chars is plenty for citation-style overlap.
  const safeTurn = turnText.slice(0, 4000);

  const result = await inferLabelsFromTurn({
    userId,
    sessionId,
    turnText: safeTurn,
  });

  return NextResponse.json({
    ok: true,
    user_scope: userId ? 'user' : 'anon',
    labels_written: result.labelsWritten,
    positive: result.positiveCount,
    negative: result.negativeCount,
  });
}
