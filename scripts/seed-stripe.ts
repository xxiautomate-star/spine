#!/usr/bin/env npx tsx
// Run once per Stripe account to create Spine's products + prices.
// Idempotent: finds existing resources by metadata tag before creating.
// Usage: STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/seed-stripe.ts

import Stripe from 'stripe';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: '2026-03-25.dahlia' as any });

async function findOrCreateProduct(
  spineId: string,
  name: string,
  description: string
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `metadata['spine_product_id']:'${spineId}'`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    console.log(`  [skip] product "${spineId}": ${existing.data[0].id}`);
    return existing.data[0];
  }
  const product = await stripe.products.create({
    name,
    description,
    metadata: { spine_product_id: spineId },
  });
  console.log(`  [new]  product "${spineId}": ${product.id}`);
  return product;
}

async function findOrCreatePrice(
  productId: string,
  spineId: string,
  unitAmount: number,
  nickname: string
): Promise<Stripe.Price> {
  const existing = await stripe.prices.search({
    query: `metadata['spine_price_id']:'${spineId}'`,
    limit: 1,
  });
  if (existing.data.length > 0) {
    console.log(`  [skip] price "${spineId}": ${existing.data[0].id}`);
    return existing.data[0];
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval: 'month' },
    nickname,
    metadata: { spine_price_id: spineId },
  });
  console.log(`  [new]  price "${spineId}": ${price.id}`);
  return price;
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(content) ? content.replace(re, line) : `${content}\n${line}`;
}

async function main() {
  console.log('Spine — Stripe seed\n');

  console.log('Products:');
  const freeProduct = await findOrCreateProduct(
    'free',
    'Spine Free',
    '100 memories · MCP for Claude Code'
  );
  const proProduct = await findOrCreateProduct(
    'pro',
    'Spine Pro',
    'Unlimited memories · cross-AI (Claude + ChatGPT + Gemini) · proactive context surfacing'
  );

  console.log('\nPrices:');
  const freePrice = await findOrCreatePrice(
    freeProduct.id,
    'free_monthly',
    0,
    'Spine Free – $0/mo'
  );
  const proPrice = await findOrCreatePrice(
    proProduct.id,
    'pro_monthly',
    2900,
    'Spine Pro – $29/mo'
  );

  const envPath = path.join(__dirname, '..', '.env.example');
  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf-8');
  } catch {
    content = [
      '# Supabase',
      'NEXT_PUBLIC_SUPABASE_URL=',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=',
      'SUPABASE_SERVICE_ROLE_KEY=',
      '',
      '# OpenAI',
      'OPENAI_API_KEY=',
      '',
      '# Stripe',
      'STRIPE_SECRET_KEY=',
      'STRIPE_WEBHOOK_SECRET=',
      'STRIPE_FREE_PRICE_ID=',
      'STRIPE_PRO_PRICE_ID=',
      '',
      '# App',
      'NEXT_PUBLIC_APP_URL=https://spine.xxiautomate.com',
      'ENGINE_ACCESS_PASSWORD=',
    ].join('\n');
  }

  content = upsertEnvLine(content, 'STRIPE_FREE_PRICE_ID', freePrice.id);
  content = upsertEnvLine(content, 'STRIPE_PRO_PRICE_ID', proPrice.id);

  fs.writeFileSync(envPath, content.trimStart() + '\n');

  console.log(`\nWrote to ${envPath}:`);
  console.log(`  STRIPE_FREE_PRICE_ID=${freePrice.id}`);
  console.log(`  STRIPE_PRO_PRICE_ID=${proPrice.id}`);
  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
