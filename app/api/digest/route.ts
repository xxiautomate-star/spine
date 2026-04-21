// GET  /api/digest         — list digests for the user (newest first)
// POST /api/digest         — trigger on-demand digest for a specific date window
// Auth: session cookie

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { generateDigest } from '@/lib/daily-digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data, error } = await sb
    .from('digests')
    .select('id, date, themes, decisions, questions, nags, memory_count, sent_at, created_at')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach resolution status for each digest's questions.
  const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
  let resolutionMap = new Map<string, Set<number>>();
  if (ids.length > 0) {
    const { data: resolutions } = await sb
      .from('digest_resolutions')
      .select('digest_id, item_index, item_type')
      .in('digest_id', ids)
      .eq('item_type', 'question');

    for (const r of (resolutions ?? []) as { digest_id: string; item_index: number }[]) {
      if (!resolutionMap.has(r.digest_id)) resolutionMap.set(r.digest_id, new Set());
      resolutionMap.get(r.digest_id)!.add(r.item_index);
    }
  }

  const digests = ((data ?? []) as Array<{
    id: string;
    date: string;
    themes: unknown[];
    decisions: unknown[];
    questions: unknown[];
    nags: unknown[];
    memory_count: number;
    sent_at: string | null;
    created_at: string;
  }>).map((d) => ({
    ...d,
    resolvedQuestions: [...(resolutionMap.get(d.id) ?? [])],
  }));

  return NextResponse.json({ digests });
}

export async function POST(req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  if (!user.email) return NextResponse.json({ error: 'Account has no email address.' }, { status: 400 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let windowStart: string;
  let windowEnd: string;

  try {
    const body = (await req.json()) as { date?: string };
    if (body.date) {
      // Digest for a specific calendar day.
      windowStart = new Date(`${body.date}T00:00:00.000Z`).toISOString();
      windowEnd   = new Date(`${body.date}T23:59:59.999Z`).toISOString();
    } else {
      // Default: last 24h.
      const now = new Date();
      windowEnd = now.toISOString();
      windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    }
  } catch {
    const now = new Date();
    windowEnd = now.toISOString();
    windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const result = await generateDigest(sb, user.id, user.email, windowStart, windowEnd);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Digest generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
