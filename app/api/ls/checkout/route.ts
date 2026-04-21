// POST /api/ls/checkout
// Body: { plan: 'pro' | 'team' }
// Creates a LemonSqueezy checkout session and returns the URL.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { createCheckout, lsConfigured } from '@/lib/lemonsqueezy';
import { planToVariantId, type Plan } from '@/lib/plan-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';

function isPaidPlan(v: unknown): v is Exclude<Plan, 'free'> {
  return v === 'pro' || v === 'team';
}

export async function POST(req: NextRequest) {
  if (!lsConfigured())
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let plan: Exclude<Plan, 'free'>;
  try {
    const body = (await req.json()) as { plan?: unknown };
    if (!isPaidPlan(body.plan)) {
      return NextResponse.json({ error: 'plan must be pro or team.' }, { status: 400 });
    }
    plan = body.plan;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const variantId = planToVariantId(plan);
  if (!variantId)
    return NextResponse.json({ error: `Variant ID for ${plan} not configured.` }, { status: 500 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Ensure default org exists; get org_id
  const { data: orgId } = await sb.rpc('spine_ensure_default_org', { p_user_id: user.id });

  const checkout = await createCheckout({
    variantId,
    userEmail: user.email ?? '',
    userId: user.id,
    orgId: orgId as string,
    plan,
    successUrl: `${BASE}/billing?status=success&plan=${plan}`,
    cancelUrl: `${BASE}/billing?status=cancelled`,
  });

  return NextResponse.json({ url: checkout.url });
}
