/**
 * License & plan cache for the Spine MCP.
 *
 * The money loop requires the local MCP to know which plan the user is on
 * without hitting the API on every tool call. This module:
 *
 *   - Caches the validated plan in `~/.spine/license-cache.json` with a 6h TTL.
 *   - Revalidates with `/keys/validate` on the boundary call.
 *   - Handles three failure modes cleanly:
 *       (a) Network down           → honour cache up to 14-day GRACE_DAYS window.
 *       (b) 401 (key revoked)      → drop to `free` immediately.
 *       (c) 402 (subscription end) → drop to `free` immediately.
 *   - Never throws from tool code — always returns a usable plan object.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONFIG_DIR, DEFAULT_API_BASE } from './config.js';

export type Plan = 'free' | 'pro' | 'team';

export type LicenseStatus = {
  /** Current effective plan. Honoured by callers. */
  plan: Plan;
  /** Server-declared total memory cap. `null` = unlimited. */
  cap: number | null;
  /** User id from the server. `null` when unauthenticated / offline-only. */
  userId: string | null;
  /** ISO timestamp of the most recent successful server validation. */
  validatedAt: string | null;
  /** ISO timestamp when the cache was written (write side of the same moment). */
  cachedAt: string;
  /** Reason for the current plan — telemetry-friendly string. */
  reason:
    | 'fresh'
    | 'cached'
    | 'grace'
    | 'no-key'
    | 'revoked'
    | 'subscription-ended'
    | 'server-error'
    | 'network-error';
  /** Human-readable upgrade URL to surface through the MCP. */
  upgradeUrl: string;
};

export const LICENSE_CACHE_PATH = join(CONFIG_DIR, 'license-cache.json');

/** How long a fresh validation is trusted before we revalidate. */
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
/** How long we honour a cached plan when the server is unreachable. */
const GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
/** Free-tier local memory cap. Kept in sync with the server's `plan-limits.ts`. */
export const FREE_CAP = 100;
/** Pro cap. Server is the source of truth; this is a safe client fallback. */
export const PRO_CAP = 1000;

const DEFAULT_UPGRADE_URL = 'https://spine.xxiautomate.com/pricing';

type CacheFile = {
  plan: Plan;
  cap: number | null;
  userId: string | null;
  validatedAt: string | null;
  cachedAt: string;
  reason: LicenseStatus['reason'];
  apiKeyFingerprint: string | null;
};

function fingerprintKey(key: string | undefined): string | null {
  if (!key) return null;
  // Store only the last 6 chars — enough to notice when the key changed,
  // not enough to be useful if the file leaks.
  return key.length >= 10 ? `…${key.slice(-6)}` : key;
}

function capForPlan(plan: Plan): number | null {
  if (plan === 'team') return null;
  if (plan === 'pro') return PRO_CAP;
  return FREE_CAP;
}

async function readCache(): Promise<CacheFile | null> {
  try {
    const raw = await readFile(LICENSE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed && (parsed.plan === 'free' || parsed.plan === 'pro' || parsed.plan === 'team')) {
      return parsed;
    }
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  await mkdir(dirname(LICENSE_CACHE_PATH), { recursive: true });
  await writeFile(LICENSE_CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

function statusFromCache(cache: CacheFile, reason: LicenseStatus['reason']): LicenseStatus {
  return {
    plan: cache.plan,
    cap: cache.cap,
    userId: cache.userId,
    validatedAt: cache.validatedAt,
    cachedAt: cache.cachedAt,
    reason,
    upgradeUrl: DEFAULT_UPGRADE_URL,
  };
}

function freshLocalFree(reason: LicenseStatus['reason']): LicenseStatus {
  const now = new Date().toISOString();
  return {
    plan: 'free',
    cap: FREE_CAP,
    userId: null,
    validatedAt: null,
    cachedAt: now,
    reason,
    upgradeUrl: DEFAULT_UPGRADE_URL,
  };
}

type ValidatePayload = {
  valid: boolean;
  plan: Plan;
  cap: number | null;
  userId: string;
  expiresAt: string | null;
};

async function callValidate(apiBase: string, apiKey: string): Promise<{
  kind: 'ok';
  data: ValidatePayload;
} | {
  kind: 'revoked';
} | {
  kind: 'subscription-ended';
} | {
  kind: 'server-error';
  status: number;
} | {
  kind: 'network-error';
  err: Error;
}> {
  try {
    const res = await fetch(`${apiBase}/keys/validate`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401) return { kind: 'revoked' };
    if (res.status === 402) return { kind: 'subscription-ended' };
    if (!res.ok) return { kind: 'server-error', status: res.status };
    const data = (await res.json()) as ValidatePayload;
    return { kind: 'ok', data };
  } catch (err) {
    return { kind: 'network-error', err: err as Error };
  }
}

/**
 * Resolve the current plan, using the cache when fresh and revalidating
 * when it is stale. `apiKey` may be undefined for pure-local installs.
 */
export async function getLicense(opts: {
  apiKey: string | undefined;
  apiBase?: string;
  forceRefresh?: boolean;
}): Promise<LicenseStatus> {
  const { apiKey, forceRefresh } = opts;
  const apiBase = opts.apiBase ?? DEFAULT_API_BASE;

  if (!apiKey) {
    // Unauthenticated local install. Fixed free-tier cap. Cache so the doctor
    // command can still show the last known state.
    const status = freshLocalFree('no-key');
    await writeCache({
      plan: 'free',
      cap: FREE_CAP,
      userId: null,
      validatedAt: null,
      cachedAt: status.cachedAt,
      reason: 'no-key',
      apiKeyFingerprint: null,
    });
    return status;
  }

  const fp = fingerprintKey(apiKey);
  const cache = await readCache();
  const now = Date.now();

  // If the cache matches the current key and is still within TTL, use it
  // straight away — no network round-trip on the happy path.
  if (
    !forceRefresh &&
    cache &&
    cache.apiKeyFingerprint === fp &&
    cache.validatedAt
  ) {
    const ageMs = now - new Date(cache.validatedAt).getTime();
    if (ageMs < TTL_MS) {
      return statusFromCache(cache, 'cached');
    }
  }

  const result = await callValidate(apiBase, apiKey);

  if (result.kind === 'ok') {
    const data = result.data;
    if (!data.valid) {
      // Defensive: server returned 200 but `valid=false`. Treat as revoked.
      const status = freshLocalFree('revoked');
      await writeCache({
        plan: 'free',
        cap: FREE_CAP,
        userId: null,
        validatedAt: null,
        cachedAt: status.cachedAt,
        reason: 'revoked',
        apiKeyFingerprint: fp,
      });
      return status;
    }
    const cap = data.cap ?? capForPlan(data.plan);
    const status: LicenseStatus = {
      plan: data.plan,
      cap,
      userId: data.userId,
      validatedAt: new Date().toISOString(),
      cachedAt: new Date().toISOString(),
      reason: 'fresh',
      upgradeUrl: DEFAULT_UPGRADE_URL,
    };
    await writeCache({
      plan: status.plan,
      cap: status.cap,
      userId: status.userId,
      validatedAt: status.validatedAt,
      cachedAt: status.cachedAt,
      reason: 'fresh',
      apiKeyFingerprint: fp,
    });
    return status;
  }

  if (result.kind === 'revoked') {
    const status = freshLocalFree('revoked');
    await writeCache({
      plan: 'free',
      cap: FREE_CAP,
      userId: null,
      validatedAt: null,
      cachedAt: status.cachedAt,
      reason: 'revoked',
      apiKeyFingerprint: fp,
    });
    return status;
  }

  if (result.kind === 'subscription-ended') {
    const status = freshLocalFree('subscription-ended');
    await writeCache({
      plan: 'free',
      cap: FREE_CAP,
      userId: null,
      validatedAt: null,
      cachedAt: status.cachedAt,
      reason: 'subscription-ended',
      apiKeyFingerprint: fp,
    });
    return status;
  }

  // Server error OR network error — honour the cache within the grace window.
  if (cache && cache.apiKeyFingerprint === fp && cache.validatedAt) {
    const ageMs = now - new Date(cache.validatedAt).getTime();
    if (ageMs < GRACE_MS) {
      return statusFromCache(cache, result.kind === 'network-error' ? 'network-error' : 'server-error');
    }
  }

  // No usable cache — fall through to free.
  const status = freshLocalFree(result.kind === 'network-error' ? 'network-error' : 'server-error');
  await writeCache({
    plan: 'free',
    cap: FREE_CAP,
    userId: null,
    validatedAt: null,
    cachedAt: status.cachedAt,
    reason: status.reason,
    apiKeyFingerprint: fp,
  });
  return status;
}

/**
 * Lightweight decision: "can I write one more memory?" Returns the remaining
 * slot count, or `null` if the plan is unlimited. `cap` of `null` means no cap.
 */
export function remaining(cap: number | null, used: number): number | null {
  if (cap === null) return null;
  return Math.max(0, cap - used);
}

/**
 * Build the human-facing message to surface when a write is blocked. Kept
 * terse — the MCP tool response is already a JSON string.
 */
export function upgradeCTA(status: LicenseStatus, used: number): string {
  const cap = status.cap;
  const over = cap === null ? 0 : used - cap;
  const base = `Plan: ${status.plan}. Used: ${used}${cap === null ? '' : ` / ${cap}`}`;
  if (cap === null) return base;
  if (used < cap) return base;
  return (
    `${base}. Over by ${over + 1}. ` +
    `Upgrade at ${status.upgradeUrl} to continue capturing.`
  );
}

/**
 * Verify the license cache file exists and is well-formed. Used by the
 * `doctor` command. Returns null if the cache is missing.
 */
export async function inspectCache(): Promise<(CacheFile & { ageMs: number | null }) | null> {
  const cache = await readCache();
  if (!cache) return null;
  const ageMs = cache.validatedAt
    ? Date.now() - new Date(cache.validatedAt).getTime()
    : null;
  return { ...cache, ageMs };
}

/** Test helper — not exported via package surface. */
export async function _cacheFileExists(): Promise<boolean> {
  try {
    await stat(LICENSE_CACHE_PATH);
    return true;
  } catch {
    return false;
  }
}
