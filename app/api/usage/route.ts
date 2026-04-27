// GET /api/usage
//
// Returns the caller's live memory count, plan name, cap (null for
// unlimited), percent used, and next reset (always null — Spine has no
// monthly reset; caps are total-memory caps, not per-cycle).
//
// Dual-auth: session cookie (dashboard) OR bearer key (MCP / extension).
// Dashboard reads this for the top-bar usage badge + upgrade overlay
// triggering. MCP reads it for plan-aware client-side messaging.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { captureCap, isUnlimited, type Plan } from '@/lib/plan-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

async function resolveUserAndPlan(req: NextRequest): Promise<
  | { ok: true; userId: string; plan: Plan }
  | { ok: false; error: string; status: number }
> {
  if (isAuthConfigured()) {
    const sessionUser = await getServerUser();
    if (sessionUser) {
      const sb = getSupabase();
      if (sb) {
        const { data } = await sb
          .from('profiles')
          .select('plan')
          .eq('user_id', sessionUser.id)
          .maybeSingle();
        const raw = data?.plan as string | undefined;
        const plan: Plan = raw === 'pro' || raw === 'team' ? raw : 'free';
        return { ok: true, userId: sessionUser.id, plan };
      }
    }
  }
  const auth = await requireApiKey(req);
  if (auth.authed) {
    return { ok: true, userId: auth.authed.userId, plan: auth.authed.plan };
  }
  return { ok: false, error: auth.error, status: auth.status };
}

export async function GET(req: NextRequest) {
  const resolved = await resolveUserAndPlan(req);
  if (!resolved.ok) {
    return withCors(NextResponse.json({ error: resolved.error }, { status: resolved.status }));
  }

  const supabase = getSupabase();
  if (!supabase)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  const { count, error } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', resolved.userId)
    .is('deleted_at', null);
  if (error) return withCors(NextResponse.json({ error: error.message }, { status: 500 }));

  const current = count ?? 0;
  const unlimited = isUnlimited(resolved.plan);
  const cap = unlimited ? null : captureCap(resolved.plan);
  const pctUsed = unlimited || !cap ? 0 : Math.min(100, Math.round((current / cap) * 100));

  return withCors(
    NextResponse.json({
      count: current,
      // memoryCount is an alias for `count` so older clients reading either
      // field continue to work. Both are the same number.
      memoryCount: current,
      plan: resolved.plan,
      limit: cap,
      pctUsed,
      nextReset: null,
    })
  );
}
