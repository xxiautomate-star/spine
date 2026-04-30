// Gate 3 — plan-cap enforcement (integration spec).
//
// Runs against a deployed staging Spine. Verifies that /api/capture
//   - rejects a free user at-or-above cap with a 402 carrying the documented
//     response shape (error_code, upgrade_url, next_plan, count, limit)
//   - admits a free user under cap (smoke check that we didn't break the
//     happy path)
//   - never rejects a Pro key for plan-cap reasons (Pro is unlimited)
//
// Required env (test fails loudly if absent — never silent-skip):
//   STAGING_BASE_URL          — e.g. https://spine.xxiautomate.com
//   STAGING_FREE_AT_CAP_KEY   — bearer for a free-plan user with >= cap memories
//   STAGING_FREE_UNDER_CAP_KEY — bearer for a free-plan user well under cap
//   STAGING_PRO_KEY           — bearer for a Pro-plan user (sanity check)
//
// Notes:
//   - The "under cap" user gains one memory per CI run with a unique tag
//     so test data is recoverable but not unbounded — pruning is left to
//     the maintenance cron (Gate brief 025).
//   - The "at cap" user must already be at or above PLAN_LIMITS.free.captureCap.
//     Reuse the recall-quality seed user from Gate 2 (it ships with ~200
//     themed memories — exactly at cap on the canonical free limit).

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = process.env.STAGING_BASE_URL ?? 'http://localhost:3000';
const FREE_AT_CAP = process.env.STAGING_FREE_AT_CAP_KEY ?? '';
const FREE_UNDER_CAP = process.env.STAGING_FREE_UNDER_CAP_KEY ?? '';
const PRO_KEY = process.env.STAGING_PRO_KEY ?? '';

async function capture(
  request: APIRequestContext,
  bearer: string,
  body: Record<string, unknown>
) {
  return request.post(`${BASE}/api/capture`, {
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    data: body,
  });
}

test.describe('Gate 3 — plan-cap enforcement', () => {
  test.beforeAll(() => {
    if (
      !process.env.STAGING_BASE_URL ||
      !process.env.STAGING_FREE_AT_CAP_KEY ||
      !process.env.STAGING_FREE_UNDER_CAP_KEY ||
      !process.env.STAGING_PRO_KEY
    ) {
      throw new Error(
        'Gate 3 requires STAGING_BASE_URL + STAGING_FREE_AT_CAP_KEY + ' +
          'STAGING_FREE_UNDER_CAP_KEY + STAGING_PRO_KEY. Refusing to silent-skip.'
      );
    }
  });

  test('free user at cap → 402 with upgrade_url', async ({ request }) => {
    const res = await capture(request, FREE_AT_CAP, {
      content: 'plan-cap test: should be rejected — user is at cap.',
      tags: ['gate3:cap-test'],
    });
    expect(res.status(), 'must be 402 Payment Required').toBe(402);
    const body = (await res.json()) as Record<string, unknown>;

    // Documented contract — every field MCP clients depend on.
    expect(body.error_code).toBe('plan_upgrade_required');
    expect(body.plan).toBe('free');
    expect(body.next_plan).toBe('pro');
    expect(typeof body.count).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(body.count).toBeGreaterThanOrEqual(body.limit as number);

    expect(typeof body.upgrade_url).toBe('string');
    const parsed = new URL(body.upgrade_url as string);
    expect(parsed.pathname).toBe('/billing');
    expect(parsed.searchParams.get('upgrade')).toBe('pro');

    // Human-readable error mentions the limit so the user understands why.
    expect(body.error).toContain(String(body.limit));
  });

  test('free user under cap → 200 happy path', async ({ request }) => {
    // Stamp the memory uniquely so we can identify it in audit logs.
    const stamp = `gate3-under-cap-${Date.now()}`;
    const res = await capture(request, FREE_UNDER_CAP, {
      content: `plan-cap smoke: under-cap free user should be able to capture (${stamp})`,
      type: 'fact',
      tags: ['gate3:under-cap', stamp],
    });
    expect(res.status(), `under-cap free capture must succeed: ${await res.text()}`).toBe(200);
    const body = (await res.json()) as { id?: string; ok?: boolean };
    // /api/capture returns either an id (single) or a count (bulk). Accept
    // any 200 shape — the precise shape is not what this gate covers.
    expect(body).toBeTruthy();
  });

  test('Pro user is never plan-capped (unlimited)', async ({ request }) => {
    // A Pro user can capture indefinitely. We assert that a fresh capture
    // succeeds — this is a smoke check, not a stress test (no point in
    // burning OpenAI cost spamming 50k items).
    const stamp = `gate3-pro-${Date.now()}`;
    const res = await capture(request, PRO_KEY, {
      content: `plan-cap smoke: pro user should never be capped (${stamp})`,
      type: 'fact',
      tags: ['gate3:pro-smoke', stamp],
    });
    expect(res.status(), `pro capture must succeed: ${await res.text()}`).toBe(200);
  });

  test('cap rejection includes filtered_skipped count for bulk requests', async ({ request }) => {
    // Bulk request from at-cap user. Mix in some clearly-low-signal items
    // (one-word "ok"). Server should reject the batch but report how many
    // would have been filtered as low-signal — the user should know that
    // upgrading covers the high-signal items, not the noise.
    const res = await capture(request, FREE_AT_CAP, {
      bulk: [
        { content: 'plan-cap bulk test high-signal item', tags: ['gate3:bulk'] },
        { content: 'plan-cap bulk test another high-signal item', tags: ['gate3:bulk'] },
      ],
    });
    expect(res.status()).toBe(402);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error_code).toBe('plan_upgrade_required');
    expect(typeof body.attempted).toBe('number');
    expect(typeof body.filtered_skipped).toBe('number');
    expect((body.attempted as number) + (body.filtered_skipped as number)).toBe(2);
  });
});
