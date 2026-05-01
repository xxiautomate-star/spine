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
    captureCap: 200,
    priorityRerank: false,
    conflictDetection: false,
    decayRecovery: false,
    requiredContextPins: false,
    sharedWorkspace: false,
    auditLog: false,
    maxSeats: 1,
    tagline: 'A quiet beginning.',
    features: [
      '200 memories',
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

// Daily recall rate limits — Gate B of the launch stress-test brief.
// Soft = the threshold beyond which we throttle to keep COGS sane;
// hard = the absolute ceiling beyond which we 429 outright. Free has no
// soft tier (every recall costs us inference) — soft == hard. Team
// effectively has no hard ceiling (Number.POSITIVE_INFINITY) so a power
// org can run an audit job without paging support.
export type RecallLimit = { soft: number; hard: number };

export const RECALL_LIMITS: Record<Plan, RecallLimit> = {
  free: { soft: 50, hard: 50 },
  pro: { soft: 1000, hard: 5000 },
  team: { soft: 50000, hard: Number.POSITIVE_INFINITY },
};

export function recallLimits(plan: Plan): RecallLimit {
  return RECALL_LIMITS[plan];
}

// Suggest the next paid tier when a user hits their plan cap. Free users
// upgrade to Pro; Pro users go to Team. Team has no cap, so this is a
// theoretical fallback — return Team to itself rather than throw.
export function nextPaidPlan(plan: Plan): Exclude<Plan, 'free'> {
  return plan === 'free' ? 'pro' : 'team';
}

// Build the deep-link the MCP client / dashboard should open when a capture
// is rejected for plan-cap. /billing renders the LemonSqueezy upgrade
// buttons; ?upgrade= preselects the suggested tier. Returns the URL only —
// the caller wraps it in their JSON response.
export function buildUpgradeUrl(plan: Plan, baseUrlOverride?: string): string {
  const base =
    baseUrlOverride ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://spine.xxiautomate.com';
  return `${base}/billing?upgrade=${nextPaidPlan(plan)}`;
}

export type PlanCapError = {
  error: string;
  error_code: 'plan_upgrade_required';
  plan: Plan;
  count: number;
  limit: number;
  attempted: number;
  filtered_skipped: number;
  upgrade_url: string;
  next_plan: Exclude<Plan, 'free'>;
};

// Single source of truth for the 402 body shape. Used by /api/capture and
// any future write endpoint that enforces caps. Pure — no Next dependency,
// no env reads beyond buildUpgradeUrl.
export function buildPlanCapError(input: {
  plan: Plan;
  count: number;
  limit: number;
  attempted: number;
  filteredSkipped: number;
  baseUrlOverride?: string;
}): PlanCapError {
  const { plan, count, limit, attempted, filteredSkipped } = input;
  return {
    error: `Plan cap reached: ${PLAN_LIMITS[plan].name} allows ${limit} memories. Upgrade to add more.`,
    error_code: 'plan_upgrade_required',
    plan,
    count,
    limit,
    attempted,
    filtered_skipped: filteredSkipped,
    upgrade_url: buildUpgradeUrl(plan, input.baseUrlOverride),
    next_plan: nextPaidPlan(plan),
  };
}
