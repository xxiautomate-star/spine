// POST /api/stripe/checkout
// Body: { plan: 'pro' | 'power' }
// Creates (or reuses) a Stripe customer for the signed-in user and returns a
// Checkout Session URL. The subscription is realised in the webhook handler —
// nothing on profiles changes here.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { getStripe, publicBaseUrl, stripeConfigured } from '@/lib/stripe';
import { planToPriceId } from '@/lib/plan-limits';
import type { Plan } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPaidPlan(v: unknown): v is Exclude<Plan, 'free'> {
  return v === 'pro' || v === 'power';
}

export async function POST(req: NextRequest) {
  if (!stripeConfigured())
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let plan: Plan | null = null;
  try {
    const body = (await req.json()) as { plan?: unknown };
    if (isPaidPlan(body.plan)) plan = body.plan;
  } catch {
    // fall through
  }
  if (!plan) return NextResponse.json({ error: 'Valid plan is required.' }, { status: 400 });

  const priceId = planToPriceId(plan);
  if (!priceId)
    return NextResponse.json(
      { error: `Price id for ${plan} is not configured.` },
      { status: 500 }
    );

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Load or create the Stripe customer for this user.
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const stripe = getStripe();
  let customerId = profile?.stripe_customer_id as string | null | undefined;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { spine_user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from('profiles')
      .upsert(
        { user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
  }

  const base = publicBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: user.id,
    subscription_data: {
      metadata: { spine_user_id: user.id, spine_plan: plan },
    },
    success_url: `${base}/dashboard/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/dashboard/billing?status=cancelled`,
  });

  if (!session.url)
    return NextResponse.json({ error: 'Stripe did not return a URL.' }, { status: 500 });

  return NextResponse.json({ url: session.url });
}
