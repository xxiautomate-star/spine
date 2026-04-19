// POST /api/stripe/portal
// Returns a Stripe Customer Portal URL for the signed-in user. Users manage
// plan changes, payment methods, invoices, and cancellations there — we only
// observe the outcome via the webhook.

import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { getStripe, publicBaseUrl, stripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!stripeConfigured())
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const customerId = profile?.stripe_customer_id as string | null | undefined;
  if (!customerId)
    return NextResponse.json(
      { error: 'No Stripe customer yet. Upgrade first to open the billing portal.' },
      { status: 400 }
    );

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${publicBaseUrl()}/dashboard/billing`,
  });

  return NextResponse.json({ url: session.url });
}
