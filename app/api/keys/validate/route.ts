/**
 * GET /api/keys/validate
 *
 * Lightweight endpoint the MCP polls every ~6h to resolve the caller's plan.
 * Returns:
 *   200 { valid, plan, cap, userId, expiresAt }
 *   401 { error: 'Unknown API key' }     — cache should fall back to free
 *   402 { error: 'Subscription ended' }  — paid plan lapsed; cache falls to free
 *   429 { error: 'Rate limited' }        — MCP should backoff and honour cache
 *   500 { error: 'Not configured' }      — MCP should honour cache within grace
 *
 * Kept intentionally simple and cheap. No side effects beyond touching
 * `last_used_at` on the api_keys row.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { hashApiKey } from '@/lib/auth';
import { PLAN_LIMITS, type PlanTier } from '@/lib/plan-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Plan = 'free' | 'pro' | 'team';

function capForPlan(plan: Plan): number | null {
  const tier: PlanTier = PLAN_LIMITS[plan];
  return Number.isFinite(tier.captureCap) ? tier.captureCap : null;
}

export async function GET(req: NextRequest) {
  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  }
  const key = header.slice(7).trim();
  if (!key.startsWith('spine_live_')) {
    return NextResponse.json({ error: 'Invalid key format' }, { status: 401 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const keyHash = hashApiKey(key);

  const { data: keyRow, error: keyErr } = await supabase
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (keyErr) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!keyRow) {
    return NextResponse.json({ error: 'Unknown API key' }, { status: 401 });
  }
  // Explicit revocation — treat as permanent 401 so the MCP drops to free.
  if ((keyRow as { revoked_at: string | null }).revoked_at) {
    return NextResponse.json({ error: 'Key revoked' }, { status: 401 });
  }

  const userId = (keyRow as { user_id: string }).user_id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, subscription_status, subscription_current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  const rawPlan = (profile?.plan ?? 'free') as string;
  let plan: Plan = rawPlan === 'pro' || rawPlan === 'team' ? rawPlan : 'free';

  const status = (profile?.subscription_status ?? null) as string | null;
  const periodEnd = (profile?.subscription_current_period_end ?? null) as string | null;

  // If the profile claims a paid plan but Stripe has marked the subscription
  // as past_due / canceled / unpaid, return 402 so the MCP drops to free
  // without requiring a new webhook round-trip.
  if (plan !== 'free' && status && status !== 'active' && status !== 'trialing') {
    return NextResponse.json(
      {
        error: 'Subscription not active',
        status,
        currentPeriodEnd: periodEnd,
      },
      { status: 402 },
    );
  }

  // Fire-and-forget touch — no await, no failure bubbling.
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', (keyRow as { id: string }).id)
    .then(() => {
      /* best-effort */
    });

  return NextResponse.json({
    valid: true,
    plan,
    cap: capForPlan(plan),
    userId,
    expiresAt: periodEnd,
  });
}
