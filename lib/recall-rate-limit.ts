// Daily recall rate limit. Gate B of the launch stress-test brief.
//
// Plan-tier ceilings are in lib/plan-limits.ts. This module is the live
// counter — increments per recall, checks against the plan limit, returns
// either "allow" or "throttle" with a Retry-After hint so the caller can
// 429 cleanly.
//
// Storage: Postgres via Supabase, UTC-day buckets. The increment is a
// single SQL round-trip (`spine_increment_recall_count`) so concurrent
// recalls can't race past the cap. If the DB is unreachable, we fall
// back to in-memory counters — better to over-permit than to brick
// recall under a Supabase outage. Logged so we know it happened.

import { recallLimits, type Plan, RECALL_LIMITS } from './plan-limits';
import { getSupabase } from './supabase';

export type RateLimitVerdict =
  | { allowed: true; count: number; limit: number; soft: number; remaining: number }
  | {
      allowed: false;
      count: number;
      limit: number;
      soft: number;
      remaining: 0;
      retryAfterSeconds: number;
    };

const inMemoryCounts = new Map<string, { day: string; count: number }>();
const SOFT_THROTTLE_DELAY_SECONDS = 30; // hint when soft<count<hard

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilUtcMidnight(now = new Date()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

async function incrementInDb(
  userId: string,
  day: string,
  increment: number
): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc('spine_increment_recall_count', {
      p_user_id: userId,
      p_day_utc: day,
      p_increment: increment,
    });
    if (error) {
      console.warn('[recall-rate-limit] DB error, falling back to in-memory:', error.message);
      return null;
    }
    if (typeof data === 'number') return data;
    if (Array.isArray(data) && typeof data[0] === 'number') return data[0];
    return null;
  } catch (err) {
    console.warn('[recall-rate-limit] DB threw, falling back to in-memory:', err);
    return null;
  }
}

function incrementInMemory(userId: string, day: string, increment: number): number {
  const key = userId;
  const existing = inMemoryCounts.get(key);
  if (!existing || existing.day !== day) {
    const fresh = { day, count: increment };
    inMemoryCounts.set(key, fresh);
    return fresh.count;
  }
  existing.count += increment;
  return existing.count;
}

/**
 * Check + increment in one call. Always increments — we count the
 * attempt regardless of outcome, so spam at the limit doesn't get
 * "free" tries by hammering until one slips through. The verdict tells
 * the caller whether to proceed.
 */
export async function checkAndCount(
  userId: string,
  plan: Plan,
  now = new Date()
): Promise<RateLimitVerdict> {
  const day = utcDay(now);
  const { soft, hard } = recallLimits(plan);

  // Try DB first; in-memory is the fallback if DB is down or unconfigured.
  let count = await incrementInDb(userId, day, 1);
  if (count === null) count = incrementInMemory(userId, day, 1);

  const limit = hard;
  const remaining = Math.max(0, limit - count);

  if (count > hard) {
    return {
      allowed: false,
      count,
      limit,
      soft,
      remaining: 0,
      retryAfterSeconds: secondsUntilUtcMidnight(now),
    };
  }

  // Soft cap exceeded but under hard: still allowed, but we surface this
  // in the response so clients can back off voluntarily. The caller
  // returns `Retry-After: 30` as a hint without 429-ing.
  return { allowed: true, count, limit, soft, remaining };
}

export { RECALL_LIMITS, recallLimits, SOFT_THROTTLE_DELAY_SECONDS };
