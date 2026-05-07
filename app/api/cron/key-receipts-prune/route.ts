// POST /api/cron/key-receipts-prune
// Trims api_key_uses to the last N receipts per key. Runs nightly.
// Auth: CRON_SECRET bearer.
//
// Without this, `api_key_uses` grows linearly with request volume.
// 100 receipts per key is enough for "what's been hitting this key
// recently?" — the dashboard never reads more than 20 at once.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEEP_PER_KEY = 100;

export async function POST(req: NextRequest) {
  // Fail-CLOSED: if CRON_SECRET is unset, this route is unreachable.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET unset.' }, { status: 500 });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) {
    return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  }

  try {
    const { data, error } = await sb.rpc('spine_prune_key_uses', {
      p_keep_per_key: KEEP_PER_KEY,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const deleted =
      typeof data === 'number'
        ? data
        : Array.isArray(data) && typeof data[0] === 'number'
          ? data[0]
          : 0;
    return NextResponse.json({ ok: true, deleted, keptPerKey: KEEP_PER_KEY });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Prune failed.' },
      { status: 500 }
    );
  }
}
