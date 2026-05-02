// Gate 1 — pure-logic unit tests for lib/auth.ts.
//
// Mock-based, runs offline. Validates that the bearer-auth helper:
//   - rejects missing header (401)
//   - rejects malformed key prefix (401)
//   - rejects unknown key hash (401)
//   - returns user_id + plan + key_id from the api_keys row
//   - returns the WRONG user_id is impossible — i.e. no path through the
//     code returns a user_id derived from anything other than the row that
//     matched on key_hash
//
// Run: npx vitest run tests/auth-unit.test.ts

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the supabase singleton before importing auth. The mock supports both
// chained `.from(...).select().eq().maybeSingle()` reads and the
// fire-and-forget `.from(...).update(...).eq(...).then(...)` plus
// `.rpc(...).then(...)` writes used by the auth helper.
const mockMaybeSingle = vi.fn();
const thenable = { then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb) };
const mockSb = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => thenable),
    })),
  })),
  rpc: vi.fn(() => thenable),
};

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mockSb,
}));

import { hashApiKey, requireApiKey } from '@/lib/auth';
import { NextRequest } from 'next/server';

function fakeReq(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  // Minimal NextRequest stub — only headers are read by requireApiKey.
  return { headers } as unknown as NextRequest;
}

describe('hashApiKey', () => {
  it('produces stable sha256 hex', () => {
    const a = hashApiKey('spine_live_abc');
    const b = hashApiKey('spine_live_abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different inputs produce different hashes', () => {
    expect(hashApiKey('spine_live_a')).not.toBe(hashApiKey('spine_live_b'));
  });
});

describe('requireApiKey — rejection paths', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it('rejects request with no Authorization header', async () => {
    const result = await requireApiKey(fakeReq());
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
  });

  it('rejects non-bearer scheme', async () => {
    const result = await requireApiKey(fakeReq('Basic xyz'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
  });

  it('rejects key without spine_live_ prefix', async () => {
    const result = await requireApiKey(fakeReq('Bearer sk_live_test'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
    // Critical: Supabase must NOT have been queried — we short-circuit
    // on prefix to avoid a timing-side-channel that hints whether a key
    // shape is one we recognise.
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('rejects unknown key (no DB row)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await requireApiKey(fakeReq('Bearer spine_live_unknown'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
  });

  it('rejects key when api_keys query errors', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'pg-down' } });
    const result = await requireApiKey(fakeReq('Bearer spine_live_anything'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
  });
});

describe('requireApiKey — accept path tenant binding', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it('user_id in result is sourced ONLY from the matched api_keys row', async () => {
    // Simulate the api_keys lookup returning a specific user_id. The
    // bearer is whatever string — auth must NOT trust anything in the
    // request beyond the prefix check + the row's user_id field.
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'key-123',
          user_id: 'eve-uuid-aaaa',
          scope: 'full',
          expires_at: null,
        },
        error: null,
      })
      // profile + org lookups
      .mockResolvedValueOnce({ data: { plan: 'pro' }, error: null })
      .mockResolvedValueOnce({ data: { default_org_id: null }, error: null });

    const result = await requireApiKey(fakeReq('Bearer spine_live_eve'));
    expect(result.authed).not.toBeNull();
    expect(result.authed?.userId).toBe('eve-uuid-aaaa');
    expect(result.authed?.keyId).toBe('key-123');
    expect(result.authed?.plan).toBe('pro');
    expect(result.authed?.scope).toBe('full');
    expect(result.authed?.expiresAt).toBeNull();
  });

  it('rejects orphan api_keys row with null user_id', async () => {
    // Defensive: if a row exists for this key_hash but its user_id is null
    // (deleted user, or schema bug), requireApiKey must NOT return an
    // authed session with a null userId — that would let a "phantom" bearer
    // write memories with no owner, bypassing every tenant filter downstream.
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: 'key-orphan', user_id: null, scope: 'full', expires_at: null },
      error: null,
    });
    const result = await requireApiKey(fakeReq('Bearer spine_live_orphan'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
  });

  it('rejects a key past its expiry', async () => {
    // Gate E: keys with expires_at <= now must 401 even when the row
    // is otherwise valid.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        id: 'key-stale',
        user_id: 'user-uuid',
        scope: 'full',
        expires_at: yesterday,
      },
      error: null,
    });
    const result = await requireApiKey(fakeReq('Bearer spine_live_stale'));
    expect(result.authed).toBeNull();
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/expired/i);
  });

  it('coerces unknown scope values to "full" rather than failing closed', async () => {
    // If the DB ever returns a scope value not in our enum (legacy data,
    // schema drift), we fall back to 'full' so existing keys keep
    // working. The CHECK constraint in migration 029 prevents fresh
    // bad writes; this is purely a forward-compat safety.
    mockMaybeSingle
      .mockResolvedValueOnce({
        data: {
          id: 'key-legacy',
          user_id: 'user-uuid',
          scope: 'admin', // not in our enum
          expires_at: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { plan: 'free' }, error: null })
      .mockResolvedValueOnce({ data: { default_org_id: null }, error: null });
    const result = await requireApiKey(fakeReq('Bearer spine_live_legacy'));
    expect(result.authed?.scope).toBe('full');
  });
});
