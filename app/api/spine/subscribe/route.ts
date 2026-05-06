/**
 * /api/spine/subscribe — finalise a PayPal subscription -> mint API key.
 *
 * Called by the checkout page once PayPal returns a subscription ID.
 * Verifies the subscription with PayPal's REST API, then creates a
 * `spine_api_keys` row tied to the calling user (or a guest user record
 * if no auth session exists).
 *
 * Body:
 *   { subscription_id: string, tier_id: string, email?: string }
 *
 * Returns:
 *   { ok: true, api_key: string } on success
 *   { error: string } on failure
 *
 * NOTE: this endpoint does NOT charge the customer — PayPal already did.
 * Our job is to verify + provision.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { getSupabase } from '@/lib/supabase/service';
import { getServerUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAYPAL_BASE =
  process.env.PAYPAL_API_BASE ??
  (process.env.NODE_ENV === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com');

async function paypalAccessToken(): Promise<string | null> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) return null;
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function verifySubscription(subscriptionId: string): Promise<{
  ok: boolean;
  status?: string;
  error?: string;
}> {
  const token = await paypalAccessToken();
  if (!token) {
    return { ok: false, error: 'PayPal not configured on server.' };
  }
  const res = await fetch(
    `${PAYPAL_BASE}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    return { ok: false, error: `PayPal subscription lookup failed (${res.status}).` };
  }
  const body = (await res.json()) as { status?: string };
  if (body.status !== 'ACTIVE' && body.status !== 'APPROVED') {
    return { ok: false, status: body.status, error: `Subscription status is ${body.status}.` };
  }
  return { ok: true, status: body.status };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const { subscription_id, tier_id } = (body ?? {}) as {
    subscription_id?: unknown;
    tier_id?: unknown;
  };
  if (typeof subscription_id !== 'string' || subscription_id.length < 4) {
    return NextResponse.json({ error: 'subscription_id required.' }, { status: 400 });
  }
  if (typeof tier_id !== 'string' || tier_id.length < 1) {
    return NextResponse.json({ error: 'tier_id required.' }, { status: 400 });
  }

  // Verify the subscription is real + active before provisioning anything.
  const verification = await verifySubscription(subscription_id);
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error ?? 'Could not verify subscription.' },
      { status: 502 }
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: 'Server not configured for subscription provisioning.' },
      { status: 503 }
    );
  }

  // Resolve calling user — accept the cookie session if present.
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json(
      {
        error:
          'You must be signed in to subscribe. Please sign in via magic link first.',
      },
      { status: 401 }
    );
  }

  // Mint the API key. Format: `spine_live_` + 24 random bytes -> 48 hex chars.
  const rawKey = `spine_live_${randomBytes(24).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const { error: insertErr } = await supabase.from('api_keys').insert({
    user_id: user.id,
    key_hash: keyHash,
    name: `paypal-${tier_id}-${new Date().toISOString().slice(0, 10)}`,
  });
  if (insertErr) {
    console.error('[subscribe] api_keys insert failed', insertErr);
    return NextResponse.json(
      { error: 'Could not provision API key. Contact support.' },
      { status: 500 }
    );
  }

  // Bump profile plan based on tier.
  const planMap: Record<string, string> = {
    spark: 'free',
    studio: 'pro',
    'studio-pro': 'team',
  };
  const newPlan = planMap[tier_id] ?? 'pro';
  const { error: planErr } = await supabase
    .from('profiles')
    .upsert({ user_id: user.id, plan: newPlan });
  if (planErr) {
    console.warn('[subscribe] plan update failed (non-fatal)', planErr);
  }

  return NextResponse.json({
    ok: true,
    api_key: rawKey,
    tier: tier_id,
    plan: newPlan,
  });
}
