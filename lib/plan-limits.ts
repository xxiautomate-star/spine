// Single source of truth for plan tiers — names, LemonSqueezy variant IDs,
// feature flags, and capture caps. Import everywhere limits are needed.

export type Plan = 'free' | 'pro' | 'team';

export type PlanTier = {
  name: string;
  priceMonthly: number;
  captureCap: number;
  priorityRerank: boolean;
  conflictDetection: boolean;
  decayRecovery: boolean;
  requiredContextPins: boolean;
  sharedWorkspace: boolean;
  auditLog: boolean;
  maxSeats: number;
  tagline: string;
  features: string[];
};

export const PLAN_LIMITS: Record<Plan, PlanTier> = {
  free: {
    name: 'Free',
    priceMonthly: 0,
    captureCap: 50,
    priorityRerank: false,
    conflictDetection: false,
    decayRecovery: false,
    requiredContextPins: false,
    sharedWorkspace: false,
    auditLog: false,
    maxSeats: 1,
    tagline: 'A quiet beginning.',
    features: [
      '50 memories',
      'Claude Code MCP + browser extension',
      'Vector recall',
      'Export to JSON any time',
    ],
  },
  pro: {
    name: 'Pro',
    priceMonthly: 19,
    captureCap: Number.POSITIVE_INFINITY,
    priorityRerank: true,
    conflictDetection: true,
    decayRecovery: true,
    requiredContextPins: true,
    sharedWorkspace: false,
    auditLog: false,
    maxSeats: 1,
    tagline: 'The relationship deepens.',
    features: [
      'Unlimited memories',
      'Conflict detection + resolution',
      'Memory decay recovery',
      'Required-context pins',
      'Hybrid vector + BM25 retrieval',
      'Weekly retention digest',
    ],
  },
  team: {
    name: 'Team',
    priceMonthly: 59,
    captureCap: Number.POSITIVE_INFINITY,
    priorityRerank: true,
    conflictDetection: true,
    decayRecovery: true,
    requiredContextPins: true,
    sharedWorkspace: true,
    auditLog: true,
    maxSeats: 5,
    tagline: 'Shared memory. Collective clarity.',
    features: [
      'Everything in Pro',
      'Shared workspace (up to 5 members)',
      'Team memory policies + enforcement',
      'Org audit log',
      'Priority support',
    ],
  },
};

// LemonSqueezy variant ID mapping (set in env: LS_VARIANT_ID_PRO, LS_VARIANT_ID_TEAM)
export function variantIdToPlan(variantId: string | null | undefined): Plan | null {
  if (!variantId) return null;
  if (variantId === process.env.LS_VARIANT_ID_PRO) return 'pro';
  if (variantId === process.env.LS_VARIANT_ID_TEAM) return 'team';
  return null;
}

export function planToVariantId(plan: Plan): string | null {
  if (plan === 'pro') return process.env.LS_VARIANT_ID_PRO ?? null;
  if (plan === 'team') return process.env.LS_VARIANT_ID_TEAM ?? null;
  return null;
}

export function captureCap(plan: Plan): number {
  return PLAN_LIMITS[plan].captureCap;
}

export function isUnlimited(plan: Plan): boolean {
  return !Number.isFinite(PLAN_LIMITS[plan].captureCap);
}

export function planHas(plan: Plan, feature: keyof PlanTier): boolean {
  const val = PLAN_LIMITS[plan][feature];
  return typeof val === 'boolean' ? val : typeof val === 'number' ? val > 0 : false;
}
