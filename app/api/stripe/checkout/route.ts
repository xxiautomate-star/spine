import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, publicBaseUrl } from '@/lib/stripe';
import { getServerUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Map plan slugs → Stripe price ID env vars
const PRICE_IDS: Record<string, string | undefined> = {
  pro: process.env.STRIPE_PRICE_ID_PRO,
  team: process.env.STRIPE_PRICE_ID_POWER,   // 'team' plan uses the Power price
};

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const plan = typeof body?.plan === 'string' ? body.plan.toLowerCase() : '';
  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    return NextResponse.json(
      { error: `Unknown plan "${plan}". Must be "pro" or "team".` },
      { status: 400 },
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: 'Stripe is not configured on this server.' },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  const base = publicBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: user.id,
    success_url: `${base}/dashboard?upgraded=1`,
    cancel_url: `${base}/pricing`,
    metadata: { user_id: user.id, plan },
    subscription_data: {
      metadata: { user_id: user.id, plan },
    },
  });

  return NextResponse.json({ url: session.url });
}
