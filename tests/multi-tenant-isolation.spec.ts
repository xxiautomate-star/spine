// Gate 1 — Multi-tenant isolation stress tests.
//
// These are exploit-style tests. They simulate a malicious authenticated
// user (Mallory) trying to read or mutate Eve's data. Every attack vector
// MUST be blocked with 403/404. Anything that leaks Eve's content or ID
// is a P0 launch blocker.
//
// HOW TO RUN
//   1. Stand up a clean staging Spine with two test users + at least one
//      memory each. Set:
//        STAGING_BASE_URL=https://spine-staging.xxiautomate.com
//        EVE_API_KEY=spine_live_…       # bearer for user Eve
//        EVE_USER_ID=<uuid>
//        EVE_MEMORY_ID=<uuid>           # one memory belonging to Eve
//        MALLORY_API_KEY=spine_live_…   # bearer for user Mallory
//        MALLORY_USER_ID=<uuid>
//        SUPABASE_URL=…
//        SUPABASE_ANON_KEY=…            # public anon key for direct-DB attack
//   2. From saas/spine/: npx playwright test multi-tenant-isolation.spec.ts
//
// All tests pass when every attack vector is blocked. ANY content leak
// fails the suite — gate is hard, no exceptions.

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = process.env.STAGING_BASE_URL ?? 'http://localhost:3000';
const EVE_KEY = process.env.EVE_API_KEY ?? '';
const EVE_USER_ID = process.env.EVE_USER_ID ?? '';
const EVE_MEMORY_ID = process.env.EVE_MEMORY_ID ?? '';
const MALLORY_KEY = process.env.MALLORY_API_KEY ?? '';
const MALLORY_USER_ID = process.env.MALLORY_USER_ID ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

// Helper — bearer-auth fetch as a given user.
async function authedJson(
  request: APIRequestContext,
  path: string,
  apiKey: string,
  body?: unknown
) {
  const init: { headers: Record<string, string>; data?: unknown } = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) init.data = body;
  return request.post(`${BASE}${path}`, init);
}

test.describe('Gate 1 — Multi-tenant isolation', () => {
  test.beforeAll(() => {
    // Hard-fail the suite if env isn't wired — a silent skip would mask
    // the very risk this gate is designed to catch.
    const missing: string[] = [];
    if (!EVE_KEY) missing.push('EVE_API_KEY');
    if (!EVE_USER_ID) missing.push('EVE_USER_ID');
    if (!EVE_MEMORY_ID) missing.push('EVE_MEMORY_ID');
    if (!MALLORY_KEY) missing.push('MALLORY_API_KEY');
    if (!MALLORY_USER_ID) missing.push('MALLORY_USER_ID');
    if (missing.length > 0) {
      throw new Error(
        `Gate 1 cannot run without: ${missing.join(', ')}. ` +
          'Stand up two staging users with one memory each and re-run.'
      );
    }
  });

  // ── Attack 1 — read another user's memories via /api/recall ──────────────
  test('A1: /api/recall — Mallory cannot recall Eve\'s content', async ({ request }) => {
    // Eve captures a uniquely identifiable memory.
    const eveSecret = `EVE_SECRET_GATE1_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const captureRes = await authedJson(request, '/api/capture', EVE_KEY, {
      content: eveSecret,
    });
    expect(captureRes.ok(), 'Eve capture should succeed').toBe(true);

    // Mallory tries to recall using Eve's secret as the query — semantic
    // search would surface it if there's any cross-tenant leak.
    const recallRes = await authedJson(request, '/api/recall', MALLORY_KEY, {
      query: eveSecret,
      limit: 25,
    });

    expect(recallRes.ok(), 'recall should not 5xx').toBe(true);
    const body = (await recallRes.json()) as {
      memories?: Array<{ id: string; content: string }>;
      filtered_matches?: Array<{ id: string; content: string }>;
    };

    const surfaced = [...(body.memories ?? []), ...(body.filtered_matches ?? [])];
    const leaked = surfaced.find((m) => m.content.includes(eveSecret));
    expect(leaked, `Mallory MUST NOT see Eve's memory. Leaked: ${JSON.stringify(leaked)}`).toBeUndefined();
  });

  // ── Attack 2 — direct Supabase client with anon key ──────────────────────
  test('A2: anon-key Supabase client cannot select another user\'s memories', async ({ request }) => {
    test.skip(
      !SUPABASE_URL || !SUPABASE_ANON_KEY,
      'SUPABASE_URL/SUPABASE_ANON_KEY not set — skipping direct-DB attack'
    );

    // Ask the public REST endpoint for Eve's memories using only the
    // anon (public) key — RLS on the memories table should block this.
    const url =
      `${SUPABASE_URL}/rest/v1/memories` +
      `?user_id=eq.${encodeURIComponent(EVE_USER_ID)}` +
      '&select=id,content&limit=10';
    const res = await request.get(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    // RLS-correct outcome: 200 with [] (anon role can read nothing) OR 401/403.
    // The hard requirement is ZERO ROWS returned.
    if (res.ok()) {
      const rows = (await res.json()) as unknown[];
      expect(rows.length, `Anon-key query MUST return 0 rows, got ${rows.length}`).toBe(0);
    } else {
      // 401/403 is also acceptable — both prove no leak.
      expect([401, 403]).toContain(res.status());
    }
  });

  // ── Attack 3 — patch another user's memory via /api/capture ──────────────
  test('A3: /api/capture — mismatched user_id in payload is ignored', async ({ request }) => {
    // This attack assumes the route might accept user_id from the body and
    // attribute the capture to that user. Spine's auth pulls user_id from
    // the bearer token — body user_id should be ignored.
    const malloryPayload = {
      content: `MALLORY_TRYING_TO_IMPERSONATE_EVE_${Date.now()}`,
      user_id: EVE_USER_ID, // attempt to write into Eve's namespace
    };
    const res = await authedJson(request, '/api/capture', MALLORY_KEY, malloryPayload);

    expect(res.ok(), 'capture should still succeed (just ignore user_id)').toBe(true);
    const body = (await res.json()) as { id?: string };
    expect(body.id, 'capture should return an id').toBeTruthy();

    // Eve queries her own memories — Mallory's row MUST NOT appear.
    const eveRecall = await authedJson(request, '/api/recall', EVE_KEY, {
      query: 'MALLORY_TRYING_TO_IMPERSONATE_EVE',
      limit: 25,
    });
    expect(eveRecall.ok()).toBe(true);
    const eveBody = (await eveRecall.json()) as {
      memories?: Array<{ id: string; content: string }>;
    };
    const leaked = (eveBody.memories ?? []).find((m) => m.id === body.id);
    expect(leaked, 'Mallory\'s capture MUST NOT show up under Eve').toBeUndefined();
  });

  // ── Attack 4 — read another user's specific memory by ID ─────────────────
  test('A4: GET / PATCH / DELETE /api/memories/[id] — Mallory cannot touch Eve\'s memory', async ({ request }) => {
    // Mallory tries to PATCH Eve's memory by id using her own bearer token.
    const patchRes = await request.patch(`${BASE}/api/memories/${EVE_MEMORY_ID}`, {
      headers: {
        Authorization: `Bearer ${MALLORY_KEY}`,
        'Content-Type': 'application/json',
      },
      data: { content: 'OWNED' },
    });
    // Expected: 401 (session-auth required for this route — bearer not enough)
    // OR 404 (owner-mismatch returns "not found" rather than confirming existence).
    expect([401, 403, 404]).toContain(patchRes.status());

    // Mallory tries DELETE.
    const delRes = await request.delete(`${BASE}/api/memories/${EVE_MEMORY_ID}`, {
      headers: { Authorization: `Bearer ${MALLORY_KEY}` },
    });
    expect([401, 403, 404]).toContain(delRes.status());

    // Mallory tries the policy patch (set required_context=true on Eve's row).
    const policyRes = await request.patch(
      `${BASE}/api/memories/${EVE_MEMORY_ID}/policy`,
      {
        headers: {
          Authorization: `Bearer ${MALLORY_KEY}`,
          'Content-Type': 'application/json',
        },
        data: { required_context: true },
      }
    );
    expect([401, 403, 404]).toContain(policyRes.status());

    // Mallory tries the keep / archive endpoints (brief 025).
    for (const action of ['keep', 'archive']) {
      const r = await request.patch(
        `${BASE}/api/memories/${EVE_MEMORY_ID}/${action}`,
        { headers: { Authorization: `Bearer ${MALLORY_KEY}` } }
      );
      expect(
        [401, 403, 404],
        `Mallory MUST NOT ${action} Eve's memory — got ${r.status()}`
      ).toContain(r.status());
    }
  });

  // ── Attack 5 — recall-recent leaks Eve's session digests ─────────────────
  test('A5: /api/recall/recent — Mallory does not see Eve\'s digests/turns', async ({ request }) => {
    const res = await authedJson(request, '/api/recall/recent', MALLORY_KEY, {
      max_tokens: 4000,
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      context?: string;
      sessions_recalled?: number;
    };
    // Mallory's context block must not contain Eve's user_id, memory_id, or
    // any obviously tenant-bound markers from staging seed data.
    const ctx = body.context ?? '';
    expect(ctx).not.toContain(EVE_USER_ID);
    expect(ctx).not.toContain(EVE_MEMORY_ID);
  });
});
