// Gate E — unit tests for the scope hierarchy + expiry check.

import { describe, expect, it } from 'vitest';
import {
  isExpired,
  isKeyScope,
  scopeAllows,
  VALID_SCOPES,
  type KeyScope,
} from '@/lib/auth-scope';

describe('isKeyScope', () => {
  it.each(VALID_SCOPES)('accepts %s', (s) => {
    expect(isKeyScope(s)).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isKeyScope('admin')).toBe(false);
    expect(isKeyScope('')).toBe(false);
    expect(isKeyScope(null)).toBe(false);
    expect(isKeyScope(undefined)).toBe(false);
    expect(isKeyScope(42)).toBe(false);
    expect(isKeyScope({})).toBe(false);
  });
});

describe('scopeAllows', () => {
  it('full satisfies any required scope', () => {
    for (const r of VALID_SCOPES) {
      expect(scopeAllows('full', r)).toBe(true);
    }
  });

  it('read_write satisfies read, write, read_write', () => {
    expect(scopeAllows('read_write', 'read')).toBe(true);
    expect(scopeAllows('read_write', 'write')).toBe(true);
    expect(scopeAllows('read_write', 'read_write')).toBe(true);
  });

  it('read satisfies only read', () => {
    expect(scopeAllows('read', 'read')).toBe(true);
    expect(scopeAllows('read', 'write')).toBe(false);
    expect(scopeAllows('read', 'read_write')).toBe(false);
    expect(scopeAllows('read', 'full')).toBe(false);
  });

  it('write satisfies only write', () => {
    expect(scopeAllows('write', 'write')).toBe(true);
    expect(scopeAllows('write', 'read')).toBe(false);
    expect(scopeAllows('write', 'read_write')).toBe(false);
    expect(scopeAllows('write', 'full')).toBe(false);
  });

  it('matrix: read_write does NOT satisfy admin-tier full', () => {
    // Forward planning — `full` is reserved for ops we may add later
    // (mass-delete, key-mint). read_write should not be auto-promoted.
    expect(scopeAllows('read_write', 'full')).toBe(false);
  });
});

describe('isExpired', () => {
  it('null/undefined never expires', () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });

  it('past timestamp is expired', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it('future timestamp is not expired', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(isExpired(future)).toBe(false);
  });

  it('exactly-now is treated as expired (boundary, conservative)', () => {
    // We use <= now so the boundary case rejects. A user with a key
    // expiring "now" should be told to mint a new one rather than get
    // a flaky last-millisecond pass.
    const now = Date.now();
    const exactNow = new Date(now).toISOString();
    expect(isExpired(exactNow, now)).toBe(true);
  });

  it('garbage timestamp does NOT lock the user out (fail open)', () => {
    // Defensive: if the DB ever returns a malformed string, treating
    // it as "expired" would brick legitimate keys. Better to fail open
    // — the next legitimate refresh corrects the data.
    expect(isExpired('not-a-date')).toBe(false);
  });

  it('respects an injected `now` for deterministic testing', () => {
    const t = new Date('2026-01-01T00:00:00Z').getTime();
    const before = '2025-12-31T23:59:59Z';
    const after = '2026-01-01T00:00:01Z';
    expect(isExpired(before, t)).toBe(true);
    expect(isExpired(after, t)).toBe(false);
  });
});
