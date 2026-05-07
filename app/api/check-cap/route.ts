// GET /api/check-cap
//
// MCP-side pre-write probe so the CLI can warn the user BEFORE attempting a
// capture that will be rejected with 402. Returns the same effective cap
// the /api/capture route would compute — so a `can_capture: false` here is
// the truthful answer, not a guess. Bug A0.0.5 in the 2026-05-08 audit.
//
// Returns:
//   200 { count, plan, limit, can_capture, headroom, grandfathered, message }
//   401 { error } — bad/missing key
//   500 { error } — server not configured
//
// Cheap; no LLM calls, no embed, two SELECTs.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { captureCap, isUnlimited, PLAN_LIMITS } from '@/lib/plan-limits';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) {
    return withCors(
      NextResponse.json({ error: auth.error ?? 'Unauthorized.' }, { status: auth.status ?? 401 }),
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));
  }

  const plan = auth.authed.plan;
  const planName = PLAN_LIMITS[plan].name;

  if (isUnlimited(plan)) {
    // Pro / Team — no cap to compute. Return a stable shape so the CLI
    // doesn't have to branch on plan.
    return withCors(
      NextResponse.json({
        count: null,
        plan,
        plan_name: planName,
        limit: null,
        can_capture: true,
        headroom: null,
        grandfathered: false,
        message: `${planName} plan — unlimited captures.`,
      }),
    );
  }

  const [{ count, error: countErr }, { data: prof }] = await Promise.all([
    supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId)
      .is('deleted_at', null)
      .or('signal_tier.is.null,signal_tier.neq.low'),
    supabase
      .from('profiles')
      .select('grandfather_cap_override, grandfather_expires_at')
      .eq('user_id', auth.authed.userId)
      .maybeSingle(),
  ]);

  if (countErr) {
    return withCors(NextResponse.json({ error: countErr.message }, { status: 500 }));
  }

  const current = count ?? 0;
  const planLimit = captureCap(plan);

  let limit = planLimit;
  let grandfathered = false;
  const override = (prof as { grandfather_cap_override?: number | null } | null)
    ?.grandfather_cap_override;
  const expires = (prof as { grandfather_expires_at?: string | null } | null)
    ?.grandfather_expires_at;
  if (typeof override === 'number' && override > 0) {
    const stillActive = !expires || Date.parse(expires) > Date.now();
    if (stillActive) {
      limit = Math.max(planLimit, override);
      grandfathered = true;
    }
  }

  const headroom = Math.max(0, limit - current);
  const canCapture = headroom > 0;

  const message = canCapture
    ? grandfathered
      ? `${planName} plan with grandfather override: ${current.toLocaleString()} / ${limit.toLocaleString()} memories used.`
      : `${planName} plan: ${current.toLocaleString()} / ${limit.toLocaleString()} memories used.`
    : `${planName} cap reached: ${current.toLocaleString()} / ${limit.toLocaleString()}. Upgrade to keep capturing.`;

  return withCors(
    NextResponse.json({
      count: current,
      plan,
      plan_name: planName,
      limit,
      can_capture: canCapture,
      headroom,
      grandfathered,
      grandfather_expires_at: grandfathered ? expires ?? null : null,
      message,
    }),
  );
}
