// LemonSqueezy billing integration.
// Docs: https://docs.lemonsqueezy.com/api

const LS_API = 'https://api.lemonsqueezy.com/v1';

function lsKey(): string {
  const k = process.env.LEMONSQUEEZY_API_KEY;
  if (!k) throw new Error('LEMONSQUEEZY_API_KEY not configured.');
  return k;
}

export function lsConfigured(): boolean {
  return !!(
    process.env.LEMONSQUEEZY_API_KEY &&
    process.env.LS_STORE_ID &&
    (process.env.LS_VARIANT_ID_PRO || process.env.LS_VARIANT_ID_TEAM)
  );
}

async function lsFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${LS_API}${path}`, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      'Authorization': `Bearer ${lsKey()}`,
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LemonSqueezy ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// ── Create checkout session ───────────────────────────────────────────────────

export interface CreateCheckoutOptions {
  variantId: string;
  userEmail: string;
  userId: string;
  orgId: string;
  plan: 'pro' | 'team';
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  checkoutId: string;
}

export async function createCheckout(opts: CreateCheckoutOptions): Promise<CheckoutResult> {
  const storeId = process.env.LS_STORE_ID;
  if (!storeId) throw new Error('LS_STORE_ID not configured.');

  const payload = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email: opts.userEmail,
          custom: {
            user_id: opts.userId,
            org_id: opts.orgId,
            plan: opts.plan,
          },
        },
        checkout_options: {
          embed: false,
          media: false,
          logo: true,
        },
        product_options: {
          redirect_url: opts.successUrl,
        },
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h
      },
      relationships: {
        store: { data: { type: 'stores', id: storeId } },
        variant: { data: { type: 'variants', id: opts.variantId } },
      },
    },
  };

  const data = await lsFetch<{ data: { id: string; attributes: { url: string } } }>('/checkouts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    url: data.data.attributes.url,
    checkoutId: data.data.id,
  };
}

// ── Customer portal link ──────────────────────────────────────────────────────

export async function getPortalUrl(customerId: string): Promise<string | null> {
  try {
    const data = await lsFetch<{ data: { attributes: { urls: { customer_portal: string } } } }>(
      `/customers/${customerId}`
    );
    return data.data.attributes.urls.customer_portal ?? null;
  } catch {
    return null;
  }
}

// ── Webhook signature verification ───────────────────────────────────────────

import { createHmac } from 'node:crypto';

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return false;
  const digest = createHmac('sha256', secret).update(payload).digest('hex');
  return digest === signature;
}

// ── Webhook event types ───────────────────────────────────────────────────────

export type LSWebhookEvent =
  | 'order_created'
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_cancelled'
  | 'subscription_expired'
  | 'subscription_paused'
  | 'subscription_unpaused'
  | 'subscription_payment_success'
  | 'subscription_payment_failed';

export interface LSWebhookPayload {
  meta: {
    event_name: LSWebhookEvent;
    custom_data?: {
      user_id?: string;
      org_id?: string;
      plan?: string;
    };
  };
  data: {
    id: string;
    type: string;
    attributes: {
      status: string;
      customer_id: number;
      variant_id: number;
      order_id?: number;
      user_email?: string;
      trial_ends_at?: string | null;
      renews_at?: string | null;
      ends_at?: string | null;
    };
  };
}
