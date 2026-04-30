// Gate 3 — plan-cap enforcement (unit tests).
//
// Pure tests against lib/plan-limits.ts. The runtime cap-enforcement path
// in /api/capture/route.ts now delegates response-building to
// buildPlanCapError() — covered here. The integration spec in
// tests/plan-caps.spec.ts covers the wire-level behaviour against staging.

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  PLAN_LIMITS,
  captureCap,
  isUnlimited,
  nextPaidPlan,
  buildUpgradeUrl,
  buildPlanCapError,
  variantIdToPlan,
  planToVariantId,
  type Plan,
} from '@/lib/plan-limits';

describe('PLAN_LIMITS — source of truth', () => {
  it('Free has a finite cap and lists the cap value in features', () => {
    const free = PLAN_LIMITS.free;
    expect(Number.isFinite(free.captureCap)).toBe(true);
    expect(free.captureCap).toBeGreaterThan(0);
    // The features array surfaces the cap to the landing page; if these drift
    // out of sync the user sees one number on /pricing and gets a 402 quoting
    // a different one. The cap value must appear in at least one feature.
    expect(free.features.some((f) => f.includes(String(free.captureCap)))).toBe(true);
  });

  it('Pro and Team are unlimited (Infinity)', () => {
    expect(Number.isFinite(PLAN_LIMITS.pro.captureCap)).toBe(false);
    expect(Number.isFinite(PLAN_LIMITS.team.captureCap)).toBe(false);
  });

  it('Team has more seats than Pro and Free', () => {
    expect(PLAN_LIMITS.team.maxSeats).toBeGreaterThan(PLAN_LIMITS.pro.maxSeats);
    expect(PLAN_LIMITS.team.maxSeats).toBeGreaterThan(PLAN_LIMITS.free.maxSeats);
  });

  it('Pro and Team include the differentiating features', () => {
    expect(PLAN_LIMITS.pro.conflictDetection).toBe(true);
    expect(PLAN_LIMITS.pro.requiredContextPins).toBe(true);
    expect(PLAN_LIMITS.team.sharedWorkspace).toBe(true);
    expect(PLAN_LIMITS.team.auditLog).toBe(true);
    // Free must NOT silently inherit paid features.
    expect(PLAN_LIMITS.free.conflictDetection).toBe(false);
    expect(PLAN_LIMITS.free.sharedWorkspace).toBe(false);
    expect(PLAN_LIMITS.free.auditLog).toBe(false);
  });
});

describe('captureCap + isUnlimited', () => {
  it('returns the configured cap for free', () => {
    expect(captureCap('free')).toBe(PLAN_LIMITS.free.captureCap);
  });

  it('reports unlimited for paid plans', () => {
    expect(isUnlimited('pro')).toBe(true);
    expect(isUnlimited('team')).toBe(true);
    expect(isUnlimited('free')).toBe(false);
  });
});

describe('nextPaidPlan', () => {
  it('upgrades free to pro', () => {
    expect(nextPaidPlan('free')).toBe('pro');
  });

  it('upgrades pro to team', () => {
    expect(nextPaidPlan('pro')).toBe('team');
  });

  it('keeps team on team (terminal — no further upgrade exists)', () => {
    expect(nextPaidPlan('team')).toBe('team');
  });
});

describe('buildUpgradeUrl', () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_ENV;
  });

  it('uses NEXT_PUBLIC_APP_URL when set', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    expect(buildUpgradeUrl('free')).toBe('https://example.test/billing?upgrade=pro');
  });

  it('falls back to the production URL when env unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(buildUpgradeUrl('free')).toContain('spine.xxiautomate.com/billing');
    expect(buildUpgradeUrl('free')).toContain('upgrade=pro');
  });

  it('honours an explicit override (test convenience)', () => {
    expect(buildUpgradeUrl('pro', 'https://staging.spine.test')).toBe(
      'https://staging.spine.test/billing?upgrade=team'
    );
  });
});

describe('buildPlanCapError — 402 response shape', () => {
  it('returns the documented contract for a free user at-cap', () => {
    const err = buildPlanCapError({
      plan: 'free',
      count: PLAN_LIMITS.free.captureCap,
      limit: PLAN_LIMITS.free.captureCap,
      attempted: 1,
      filteredSkipped: 0,
      baseUrlOverride: 'https://staging.spine.test',
    });
    expect(err.error_code).toBe('plan_upgrade_required');
    expect(err.plan).toBe('free');
    expect(err.next_plan).toBe('pro');
    expect(err.upgrade_url).toBe('https://staging.spine.test/billing?upgrade=pro');
    expect(err.count).toBe(PLAN_LIMITS.free.captureCap);
    expect(err.limit).toBe(PLAN_LIMITS.free.captureCap);
    expect(err.attempted).toBe(1);
    expect(err.filtered_skipped).toBe(0);
    // Human-readable copy must mention the limit so the user understands.
    expect(err.error).toContain(String(PLAN_LIMITS.free.captureCap));
  });

  it('rejects a free user trying to bulk-capture past the cap', () => {
    const err = buildPlanCapError({
      plan: 'free',
      count: 195,
      limit: 200,
      attempted: 10,
      filteredSkipped: 2,
      baseUrlOverride: 'https://x.test',
    });
    expect(err.error_code).toBe('plan_upgrade_required');
    expect(err.next_plan).toBe('pro');
    expect(err.attempted).toBe(10);
    expect(err.filtered_skipped).toBe(2);
  });

  it('upgrade_url is a parseable URL', () => {
    const err = buildPlanCapError({
      plan: 'free',
      count: 200,
      limit: 200,
      attempted: 1,
      filteredSkipped: 0,
    });
    // Will throw if URL is not parseable.
    const parsed = new URL(err.upgrade_url);
    expect(parsed.pathname).toBe('/billing');
    expect(parsed.searchParams.get('upgrade')).toBe('pro');
  });
});

describe('variantId mapping', () => {
  const ORIGINAL_PRO = process.env.LS_VARIANT_ID_PRO;
  const ORIGINAL_TEAM = process.env.LS_VARIANT_ID_TEAM;
  afterEach(() => {
    if (ORIGINAL_PRO === undefined) delete process.env.LS_VARIANT_ID_PRO;
    else process.env.LS_VARIANT_ID_PRO = ORIGINAL_PRO;
    if (ORIGINAL_TEAM === undefined) delete process.env.LS_VARIANT_ID_TEAM;
    else process.env.LS_VARIANT_ID_TEAM = ORIGINAL_TEAM;
    vi.unstubAllEnvs();
  });

  it('round-trips: variant -> plan -> variant', () => {
    process.env.LS_VARIANT_ID_PRO = 'pro-variant-99';
    process.env.LS_VARIANT_ID_TEAM = 'team-variant-77';
    expect(variantIdToPlan('pro-variant-99')).toBe('pro');
    expect(variantIdToPlan('team-variant-77')).toBe('team');
    expect(planToVariantId('pro' as Plan)).toBe('pro-variant-99');
    expect(planToVariantId('team' as Plan)).toBe('team-variant-77');
  });

  it('unknown variant returns null', () => {
    process.env.LS_VARIANT_ID_PRO = 'pro-variant';
    expect(variantIdToPlan('unknown-variant')).toBeNull();
    expect(variantIdToPlan(null)).toBeNull();
    expect(variantIdToPlan(undefined)).toBeNull();
  });

  it('free has no variantId', () => {
    expect(planToVariantId('free' as Plan)).toBeNull();
  });
});
