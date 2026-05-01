// Gate B unit tests for daily recall rate limit.
// Mocks @/lib/supabase to control whether DB-backed counting kicks in.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RECALL_LIMITS, recallLimits } from '@/lib/plan-limits';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc }),
}));

import { checkAndCount } from '@/lib/recall-rate-limit';

describe('RECALL_LIMITS — plan ceilings', () => {
  it('Free has soft == hard (free is the floor)', () => {
    const f = recallLimits('free');
    expect(f.soft).toBe(f.hard);
    expect(f.soft).toBeGreaterThan(0);
  });

  it('Pro hard > Pro soft, both finite', () => {
    const p = recallLimits('pro');
    expect(p.hard).toBeGreaterThan(p.soft);
    expect(Number.isFinite(p.hard)).toBe(true);
  });

  it('Team hard is unlimited (Number.POSITIVE_INFINITY)', () => {
    const t = recallLimits('team');
    expect(Number.isFinite(t.hard)).toBe(false);
    expect(t.soft).toBeGreaterThan(0);
  });

  it('the three plans are monotonically increasing on soft', () => {
    expect(RECALL_LIMITS.free.soft).toBeLessThan(RECALL_LIMITS.pro.soft);
    expect(RECALL_LIMITS.pro.soft).toBeLessThan(RECALL_LIMITS.team.soft);
  });
});

describe('checkAndCount', () => {
  beforeEach(() => {
    rpc.mockReset();
  });
  afterEach(() => {
    rpc.mockReset();
  });

  it('allows a free user under cap (DB returns count=10)', async () => {
    rpc.mockResolvedValueOnce({ data: 10, error: null });
    const v = await checkAndCount('user-a', 'free');
    expect(v.allowed).toBe(true);
    expect(v.count).toBe(10);
    expect(v.limit).toBe(RECALL_LIMITS.free.hard);
    if (v.allowed) {
      expect(v.remaining).toBe(RECALL_LIMITS.free.hard - 10);
    }
  });

  it('rejects a free user over cap (DB returns count=51)', async () => {
    rpc.mockResolvedValueOnce({ data: 51, error: null });
    const v = await checkAndCount('user-b', 'free');
    expect(v.allowed).toBe(false);
    expect(v.count).toBe(51);
    if (!v.allowed) {
      expect(v.retryAfterSeconds).toBeGreaterThan(0);
      // Retry-After is bounded by seconds-until-UTC-midnight (max 86400).
      expect(v.retryAfterSeconds).toBeLessThanOrEqual(86_400);
    }
  });

  it('falls back to in-memory when DB throws', async () => {
    rpc.mockRejectedValueOnce(new Error('connection refused'));
    const v = await checkAndCount('user-c', 'free');
    // First in-memory call should return count=1 (fresh increment).
    expect(v.allowed).toBe(true);
    expect(v.count).toBe(1);
  });

  it('falls back to in-memory when DB returns an error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'pg-down' } });
    const v = await checkAndCount('user-d', 'free');
    expect(v.allowed).toBe(true);
    expect(v.count).toBe(1);
  });

  it('in-memory accumulates across calls within the same UTC day', async () => {
    rpc.mockRejectedValue(new Error('down'));
    const a = await checkAndCount('user-e', 'pro');
    const b = await checkAndCount('user-e', 'pro');
    const c = await checkAndCount('user-e', 'pro');
    expect(a.count).toBe(1);
    expect(b.count).toBe(2);
    expect(c.count).toBe(3);
  });

  it('Pro user under hard but over soft is still allowed', async () => {
    rpc.mockResolvedValueOnce({ data: 1500, error: null });
    const v = await checkAndCount('user-f', 'pro');
    expect(v.allowed).toBe(true); // 1500 > soft (1000) but < hard (5000)
    expect(v.count).toBe(1500);
    if (v.allowed) {
      expect(v.soft).toBe(1000);
      expect(v.remaining).toBe(5000 - 1500);
    }
  });

  it('Team user past pro hard is still allowed (team is effectively unlimited)', async () => {
    rpc.mockResolvedValueOnce({ data: 12000, error: null });
    const v = await checkAndCount('user-g', 'team');
    expect(v.allowed).toBe(true);
  });
});
