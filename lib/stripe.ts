// Lazy Stripe client. Server-only (never import from a client component). All
// calls go through this module so API-version pinning and missing-secret
// handling happen in exactly one place.

import Stripe from 'stripe';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  client = new Stripe(key, {
    apiVersion: '2026-03-25.dahlia',
    typescript: true,
    appInfo: { name: 'spine', version: '0.1.0' },
  });
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    'https://spine.xxiautomate.com'
  );
}
