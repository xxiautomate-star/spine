import type { Metadata } from 'next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CheckoutClient } from './CheckoutClient';

export const metadata: Metadata = {
  title: 'Checkout — Spine',
  description: 'Complete your Spine subscription. PayPal-secured. Cancel any time.',
};

export const dynamic = 'force-dynamic';

type Tier = {
  id: string;
  name: string;
  tagline: string;
  price: number | null;
  period: string;
  features: string[];
  paypal_plan_id: string | null;
  featured?: boolean;
  cta: string;
};

type TiersConfig = {
  currency: string;
  tiers: Tier[];
};

function loadTiers(): TiersConfig {
  // Read at request time — no rebuild needed when Roman edits prices.
  const path = join(process.cwd(), 'config', 'tiers.json');
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as TiersConfig;
  } catch {
    return { currency: 'USD', tiers: [] };
  }
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const params = await searchParams;
  const config = loadTiers();
  const selectedTierId = params.tier ?? 'studio';
  const paypalClientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? null;

  return (
    <CheckoutClient
      tiers={config.tiers}
      currency={config.currency}
      selectedTierId={selectedTierId}
      paypalClientId={paypalClientId}
    />
  );
}
