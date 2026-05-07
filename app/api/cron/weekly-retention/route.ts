// POST /api/cron/weekly-retention
// Called by Coolify / cron every Monday 8am UTC.
// Auth: CRON_SECRET bearer token.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { runWeeklyRetentionJob } from '@/lib/retention-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min — allow large user bases

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) {
    return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  }

  const result = await runWeeklyRetentionJob(sb);
  return NextResponse.json({ ok: true, ...result });
}

// Vercel cron sends GET with the bearer token. Same handler.
export async function GET(req: NextRequest) {
  return POST(req);
}
