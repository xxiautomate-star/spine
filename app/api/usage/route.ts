// GET /api/usage
// Bearer-auth usage status for MCP clients and the extension. Returns the
// caller's live memory count, plan name, cap (null for unlimited), percent
// used, and next reset (always null — Spine has no monthly reset yet; caps
// are total-memory caps, not per-cycle).

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { captureCap, isUnlimited } from '@/lib/plan-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  const supabase = getSupabase();
  if (!supabase)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  const { count, error } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', auth.authed.userId)
    .is('deleted_at', null);
  if (error) return withCors(NextResponse.json({ error: error.message }, { status: 500 }));

  const current = count ?? 0;
  const unlimited = isUnlimited(auth.authed.plan);
  const cap = unlimited ? null : captureCap(auth.authed.plan);
  const pctUsed = unlimited || !cap ? 0 : Math.min(100, Math.round((current / cap) * 100));

  return withCors(
    NextResponse.json({
      count: current,
      plan: auth.authed.plan,
      limit: cap,
      pctUsed,
      nextReset: null,
    })
  );
}
