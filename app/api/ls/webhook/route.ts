// POST /api/ls/webhook
// LemonSqueezy webhook handler. Verifies signature, updates org plan.
// Events handled: subscription_created, subscription_updated,
//                 subscription_cancelled, subscription_expired,
//                 subscription_paused, subscription_unpaused.

import { NextResponse, type NextRequest } from 'next/server';
import {
  verifyWebhookSignature,
  type LSWebhookPayload,
} from '@/lib/lemonsqueezy';
import { variantIdToPlan } from '@/lib/plan-limits';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Need raw body for signature verification — disable body parsing
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  let payload: LSWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LSWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const event = payload.meta.event_name;
  const attrs = payload.data.attributes;
  const custom = payload.meta.custom_data ?? {};

  const orgId = custom.org_id;
  const userId = custom.user_id;
  const lsSubId = payload.data.id;
  const lsCustomerId = String(attrs.customer_id);
  const lsVariantId = String(attrs.variant_id);
  const lsStatus = attrs.status; // active | cancelled | expired | paused | past_due

  // Hard-fail if the webhook arrives without identifying metadata. The
  // checkout route always passes org_id + user_id in custom_data, so a
  // payload with neither means either a misconfigured guest checkout or a
  // bad actor. Returning 400 makes LemonSqueezy retry (and surfaces the
  // misconfig in our logs) instead of silently 200-ing while the user's
  // plan stays on 'free'. Subscription_* events without metadata are not
  // recoverable on our side — there's no way to know who paid.
  if (!orgId && !userId) {
    return NextResponse.json(
      {
        error:
          'custom_data.org_id or custom_data.user_id required to map this webhook to a customer.',
        event,
        lsSubId,
      },
      { status: 400 },
    );
  }

  // Determine the plan from variant ID
  const plan = variantIdToPlan(lsVariantId) ?? 'free';

  // Helper: derive canonical plan status from LS status
  function orgPlan(): string {
    if (['active', 'on_trial'].includes(lsStatus)) return plan;
    return 'free';
  }

  switch (event) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_unpaused': {
      const activePlan = orgPlan();

      // Update org
      if (orgId) {
        await sb
          .from('orgs')
          .update({
            plan: activePlan,
            ls_customer_id: lsCustomerId,
            ls_subscription_id: lsSubId,
            ls_variant_id: lsVariantId,
            ls_status: lsStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orgId);
      } else if (userId) {
        // Fallback: find org by owner
        await sb
          .from('orgs')
          .update({
            plan: activePlan,
            ls_customer_id: lsCustomerId,
            ls_subscription_id: lsSubId,
            ls_variant_id: lsVariantId,
            ls_status: lsStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('owner_id', userId);
      }

      // Sync plan to profiles (denormalised for fast auth reads)
      if (userId) {
        await sb
          .from('profiles')
          .update({ plan: activePlan, updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }

      // Write audit log
      if (orgId) {
        await sb.from('org_audit_log').insert({
          org_id: orgId,
          actor_id: userId ?? '00000000-0000-0000-0000-000000000000',
          action: 'plan.upgrade',
          metadata: { event, plan: activePlan, lsSubId, lsStatus },
        }).then(() => void 0);
      }
      break;
    }

    case 'subscription_cancelled':
    case 'subscription_expired':
    case 'subscription_paused': {
      // Don't downgrade immediately on cancelled — subscription still runs until period end.
      // Do downgrade on expired.
      const shouldDowngrade = event === 'subscription_expired';

      if (orgId) {
        await sb
          .from('orgs')
          .update({
            ...(shouldDowngrade ? { plan: 'free' } : {}),
            ls_status: lsStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orgId);
      } else if (userId) {
        await sb
          .from('orgs')
          .update({
            ...(shouldDowngrade ? { plan: 'free' } : {}),
            ls_status: lsStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('owner_id', userId);
      }

      if (shouldDowngrade && userId) {
        await sb
          .from('profiles')
          .update({ plan: 'free', updated_at: new Date().toISOString() })
          .eq('user_id', userId);
      }
      break;
    }

    default:
      // subscription_payment_success, subscription_payment_failed,
      // order_created, order_refunded — all handled implicitly via
      // subscription_* events when LS replays the resulting state
      // change. Refunds in particular are managed entirely in the LS
      // dashboard; we sync state from subscription_cancelled /
      // subscription_expired downstream events, not from order_refunded.
      // Logged-and-ignored is intentional.
      break;
  }

  return NextResponse.json({ ok: true, event });
}
