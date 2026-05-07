// POST /api/cron/daily-digest
// Called by Coolify/Vercel cron at 08:00 UTC daily.
// Auth: CRON_SECRET bearer token.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runDailyDigestJob } from '@/lib/daily-digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Fail-CLOSED: if CRON_SECRET is unset, this route is unreachable. The
  // previous `if (secret) {check}` form was fail-OPEN — an env-var typo
  // exposed this DB-mutating + email-sending endpoint to the public.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET unset.' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const started = Date.now();
  try {
    const stats = await runDailyDigestJob(sb);
    return NextResponse.json({
      ok: true,
      ...stats,
      durationMs: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Digest job failed.';
    return NextResponse.json({ error: message, durationMs: Date.now() - started }, { status: 500 });
  }
}

// Vercel cron sends GET with the bearer token. Same handler.
export async function GET(req: NextRequest) {
  return POST(req);
}
