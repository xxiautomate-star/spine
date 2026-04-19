// POST /api/stripe/webhook
// Signature-verified webhook receiver. Idempotency: every event id is
// inserted into public.stripe_events ON CONFLICT DO NOTHING; zero rows
// inserted = replay, short-circuit with 200.
//
// Handled events:
//   - checkout.session.completed        → bind stripe_customer_id, upgrade plan
//   - customer.subscription.created     → upgrade plan to matching price tier
//   - customer.subscription.updated     → mirror tier/price changes
//   - customer.subscription.deleted     → downgrade to free, keep memories
//   - invoice.payment_failed            → log only; no plan change here (Stripe
//     retries + eventually subscription.deleted if it stays unpaid)

import { NextResponse, type NextRequest } from 'next/server';
import Stripe from 'stripe';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { priceIdToPlan } from '@/lib/plan-limits';
import { getSupabase } from '@/lib/supabase';
import type { Plan } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!stripeConfigured())
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 500 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json({ error: 'Webhook secret not configured.' }, { status: 500 });

  const raw = await req.text();
  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signature check failed.';
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Idempotency: insert; if the row already exists we're done.
  const { data: inserted, error: insertErr } = await admin
    .from('stripe_events')
    .insert({ event_id: event.id, type: event.type, payload: event as unknown as object })
    .select('event_id');
  if (insertErr && !/duplicate|unique/i.test(insertErr.message)) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  if (!inserted || inserted.length === 0) {
    return NextResponse.json({ ok: true, replayed: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(admin, event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(admin, event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(admin, event.data.object as Stripe.Subscription);
        break;
      default:
        // We persisted the event; ignore handlers we don't care about.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook handler failed.';
    // Re-throw to 500 so Stripe retries; remove the idempotency row so the
    // retry can actually re-run.
    await admin.from('stripe_events').delete().eq('event_id', event.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

type Admin = NonNullable<ReturnType<typeof getSupabase>>;

async function handleCheckoutCompleted(
  admin: Admin,
  session: Stripe.Checkout.Session
): Promise<void> {
  const userId =
    session.client_reference_id ??
    ((session.metadata ?? {}) as Record<string, string>).spine_user_id ??
    null;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
  if (!userId || !customerId) return;

  const stripe = getStripe();
  let plan: Plan = 'free';
  let priceId: string | null = null;
  let subscriptionId: string | null = null;

  if (session.subscription) {
    subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    priceId = subscription.items.data[0]?.price.id ?? null;
    plan = priceIdToPlan(priceId) ?? 'free';
  }

  await admin
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: priceId,
        plan,
        plan_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
}

async function handleSubscriptionUpsert(
  admin: Admin,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const tier = priceIdToPlan(priceId);
  const active =
    subscription.status === 'active' || subscription.status === 'trialing';
  const plan: Plan = active && tier ? tier : 'free';

  await admin
    .from('profiles')
    .update({
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      plan,
      plan_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);
}

async function handleSubscriptionDeleted(
  admin: Admin,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  await admin
    .from('profiles')
    .update({
      stripe_subscription_id: null,
      stripe_price_id: null,
      plan: 'free',
      plan_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', customerId);
}
