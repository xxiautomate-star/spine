import { NextResponse, type NextRequest } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabase } from '@/lib/supabase';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLAN_CAPS: Record<string, number | null> = {
  free: 100,
  pro: 1000,
  team: null,   // unlimited
};

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret.' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'signature verification failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'customer.subscription.updated'
  ) {
    let userId: string | null = null;
    let plan: string | null = null;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      userId = session.metadata?.user_id ?? session.client_reference_id ?? null;
      plan = session.metadata?.plan ?? null;
    } else {
      const sub = event.data.object as Stripe.Subscription;
      userId = sub.metadata?.user_id ?? null;
      plan = sub.metadata?.plan ?? null;
    }

    if (userId && plan) {
      const supabase = getSupabase();
      if (supabase) {
        await supabase.from('profiles').upsert(
          {
            id: userId,
            plan,
            memory_cap: PLAN_CAPS[plan] ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const userId = sub.metadata?.user_id;
    if (userId) {
      const supabase = getSupabase();
      if (supabase) {
        await supabase.from('profiles').upsert(
          {
            id: userId,
            plan: 'free',
            memory_cap: PLAN_CAPS.free,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
