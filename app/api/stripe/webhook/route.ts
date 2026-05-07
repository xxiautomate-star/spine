import { NextResponse, type NextRequest } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getSupabase } from '@/lib/supabase';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NOTE: profiles schema (supabase/schema.sql:92-104) uses `user_id` as PK,
// NOT `id`. There is no `memory_cap` column — plan caps are computed at
// read time via `captureCap(plan)` in lib/plan-limits.ts. The previous
// version of this webhook upserted into non-existent columns, so paid
// customers silently stayed on the free tier. Keep the column names below
// in lockstep with schema.sql.

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
        const now = new Date().toISOString();
        await supabase.from('profiles').upsert(
          {
            user_id: userId,
            plan,
            plan_updated_at: now,
            updated_at: now,
          },
          { onConflict: 'user_id' },
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
        const now = new Date().toISOString();
        await supabase.from('profiles').upsert(
          {
            user_id: userId,
            plan: 'free',
            plan_updated_at: now,
            updated_at: now,
          },
          { onConflict: 'user_id' },
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
