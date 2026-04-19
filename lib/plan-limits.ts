// Single source of truth for plan tiers: names, price ids, feature flags, and
// capture caps. Imported anywhere that needs to enforce or display a limit.

import type { Plan } from './auth';

export type PlanTier = {
  name: string;
  /** USD, displayed on the billing page. */
  priceMonthly: number;
  /** Cap on total (non-deleted) memories. Infinity = unlimited. */
  captureCap: number;
  /** Whether Pro/Power features are on. */
  priorityRerank: boolean;
  /** Short marketing line. */
  tagline: string;
  /** Bullets listed on the billing tile. */
  features: string[];
};

export const PLAN_LIMITS: Record<Plan, PlanTier> = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    captureCap: 100,
    priorityRerank: false,
    tagline: 'Enough to feel the shape of it.',
    features: [
      '100 memories',
      'One integration (Claude Code MCP)',
      'Vector recall, no reranker',
    ],
  },
  pro: {
    name: 'Pro',
    priceMonthly: 29,
    captureCap: 1000,
    priorityRerank: true,
    tagline: 'Your daily archive.',
    features: [
      '1,000 memories',
      'ChatGPT + Gemini browser extension',
      'Hybrid vector + BM25 retrieval',
      'Haiku 4.5 reranker',
    ],
  },
  power: {
    name: 'Power',
    priceMonthly: 99,
    captureCap: Number.POSITIVE_INFINITY,
    priorityRerank: true,
    tagline: 'Unlimited memory, forever.',
    features: [
      'Unlimited memories',
      'Priority Haiku reranker',
      'Team-shared archives (coming soon)',
      'Automation triggers (coming soon)',
    ],
  },
};

export function priceIdToPlan(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_ID_POWER) return 'power';
  return null;
}

export function planToPriceId(plan: Plan): string | null {
  if (plan === 'pro') return process.env.STRIPE_PRICE_ID_PRO ?? null;
  if (plan === 'power') return process.env.STRIPE_PRICE_ID_POWER ?? null;
  return null;
}

export function captureCap(plan: Plan): number {
  return PLAN_LIMITS[plan].captureCap;
}

export function isUnlimited(plan: Plan): boolean {
  return !Number.isFinite(PLAN_LIMITS[plan].captureCap);
}
