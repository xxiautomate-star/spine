// POST /api/cron/weekly-inbox
// Called on Sunday ~18:00 UTC.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runWeeklyInboxJob } from '@/lib/inbox-weekly';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const started = Date.now();
  try {
    const stats = await runWeeklyInboxJob(sb);
    return NextResponse.json({ ok: true, ...stats, durationMs: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Weekly inbox job failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
