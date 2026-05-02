// GET /api/keys/[id]/receipts — last N usage receipts for one of the
// caller's API keys. Cookie-session auth (this is a dashboard endpoint).
//
// Used by the dashboard's KeysClient to surface "where is this key
// being used?" before the user revokes it. Receipts are pruned to the
// last 100 per key by the nightly cron, so this is a cheap query.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clampLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 100) return n;
  return 20;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = await getServerSupabase();
  if (!sb) return NextResponse.json({ error: 'Not configured.' }, { status: 500 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });

  // Tenant scope — confirm the key belongs to this user before reading
  // its receipts. RLS would catch this too, but we want a clean 404
  // rather than an empty list when the user hits someone else's key id.
  const { data: keyRow } = await sb
    .from('api_keys')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!keyRow) {
    return NextResponse.json({ error: 'Key not found.' }, { status: 404 });
  }

  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));

  const { data, error } = await sb
    .from('api_key_uses')
    .select('id, route, scope_required, status_code, ts')
    .eq('key_id', id)
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { receipts: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
