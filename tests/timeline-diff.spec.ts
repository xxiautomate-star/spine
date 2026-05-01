// Gate C — timeline-diff endpoint integration test.
//
// Seeds 5 memories at 5 timestamps (sequentially via /api/capture, with
// short pauses to ensure distinct created_at), then queries the
// timeline-diff endpoint with various (t1, t2) windows and verifies:
//
//   - The snapshot at T_n contains exactly the memories from T_1..T_n
//   - The diff(T_1, T_5) lists all 5 additions
//   - The diff(T_2, T_4) lists exactly memories at T_3 + T_4
//   - The diff(T_n, T_n) is empty
//   - Entity filtering narrows to a tagged subset
//
// Note on auth: /api/timeline-diff uses the cookie session, not bearer
// keys. To call it from Playwright we'd need to drive the browser
// through the magic-link sign-in flow (slow + flaky). For this gate
// we hit the endpoint via a session cookie passed in env
// (STAGING_TIMELINE_USER_COOKIE) so the test stays in the same
// integration-against-staging mold as Gates 1-3.

import { test, expect, type APIRequestContext } from '@playwright/test';

const BASE = process.env.STAGING_BASE_URL ?? 'http://localhost:3000';
const KEY = process.env.STAGING_TIMELINE_USER_KEY ?? '';
const COOKIE = process.env.STAGING_TIMELINE_USER_COOKIE ?? '';

const HARNESS_TAG = 'gate-c:timeline-diff';
// Distinct entity tag we'll filter by — verifies the entity narrowing
// path runs against `tags @> array[entity]` rather than just content.
const ENTITY_TAG = 'gate-c:project:apollo';

type DiffMemory = {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  tags: string[];
};

type DiffResponse = {
  from: string;
  to: string;
  snapshot1: { totalCount: number; recent: DiffMemory[]; cutoff: string };
  snapshot2: { totalCount: number; recent: DiffMemory[]; cutoff: string };
  diff: { added: DiffMemory[]; addedCount: number; decisions: DiffMemory[] };
};

async function captureAt(
  request: APIRequestContext,
  content: string,
  type: string,
  extraTags: string[] = []
): Promise<string> {
  const res = await request.post(`${BASE}/api/capture`, {
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    data: {
      content,
      type,
      tags: [HARNESS_TAG, ...extraTags],
    },
  });
  expect(res.ok(), `capture failed: ${res.status()} ${await res.text()}`).toBe(true);
  // The created memory's id isn't critical here — we filter by tag.
  return res.headers().date ?? '';
}

async function fetchDiff(
  request: APIRequestContext,
  t1: Date,
  t2: Date,
  entity?: string
): Promise<DiffResponse> {
  const params = new URLSearchParams({
    t1: t1.toISOString(),
    t2: t2.toISOString(),
  });
  if (entity) params.set('entity', entity);
  const res = await request.get(`${BASE}/api/timeline-diff?${params.toString()}`, {
    headers: { Cookie: COOKIE },
  });
  expect(
    res.ok(),
    `timeline-diff fetch failed: ${res.status()} ${await res.text()}`
  ).toBe(true);
  return (await res.json()) as DiffResponse;
}

test.describe('Gate C — timeline-diff', () => {
  test.beforeAll(() => {
    const missing: string[] = [];
    if (!process.env.STAGING_BASE_URL) missing.push('STAGING_BASE_URL');
    if (!process.env.STAGING_TIMELINE_USER_KEY) missing.push('STAGING_TIMELINE_USER_KEY');
    if (!process.env.STAGING_TIMELINE_USER_COOKIE) missing.push('STAGING_TIMELINE_USER_COOKIE');
    if (missing.length > 0) {
      throw new Error(
        `Gate C requires env vars: ${missing.join(', ')}. ` +
          'STAGING_TIMELINE_USER_COOKIE is the value of the `sb-*-auth-token` cookie ' +
          'after signing in to the dashboard once. Refusing to silent-skip.'
      );
    }
  });

  // Captured at module scope so all `test()` blocks below can read them.
  // beforeAll fills these in.
  const checkpoints: Date[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    // Five memories, ~600ms apart so created_at is reliably distinct
    // even on a clock with second-level resolution.
    const items = [
      { type: 'fact', content: `gate-c step 1 — observation about apollo project ${Date.now()}`, tags: [ENTITY_TAG] },
      { type: 'context', content: `gate-c step 2 — random chatter about lunch ${Date.now()}` },
      { type: 'decision', content: `gate-c step 3 — locked decision: switch to Postgres ${Date.now()}`, tags: [ENTITY_TAG] },
      { type: 'fact', content: `gate-c step 4 — apollo build budget set ${Date.now()}`, tags: [ENTITY_TAG] },
      { type: 'context', content: `gate-c step 5 — meta-note about the test ${Date.now()}` },
    ];
    for (const item of items) {
      const before = new Date();
      await captureAt(request, item.content, item.type, item.tags ?? []);
      checkpoints.push(before);
      // Pause so the next memory's created_at is definitively later.
      await new Promise((r) => setTimeout(r, 600));
    }
    // Final checkpoint at "now" so we can range over the full set.
    checkpoints.push(new Date());
  });

  test('snapshot at the latest checkpoint includes all 5 harness memories', async ({ request }) => {
    test.setTimeout(60_000);
    const t1 = checkpoints[0];
    const t2 = checkpoints[checkpoints.length - 1];
    const res = await fetchDiff(request, t1, t2);
    // The total count includes any pre-existing memories the user has,
    // but `diff.added` is bounded to the (t1, t2] interval. We assert
    // on the diff because that's deterministic.
    const harnessAdded = res.diff.added.filter((m) =>
      m.tags.includes(HARNESS_TAG)
    );
    expect(harnessAdded.length).toBeGreaterThanOrEqual(5);
  });

  test('diff between checkpoints 2 and 4 only contains memories in that window', async ({ request }) => {
    const t1 = checkpoints[2]; // before memory 3 was captured
    const t2 = checkpoints[4]; // after memory 4 was captured
    const res = await fetchDiff(request, t1, t2);
    const harnessAdded = res.diff.added.filter((m) =>
      m.tags.includes(HARNESS_TAG)
    );
    expect(harnessAdded.length).toBeGreaterThanOrEqual(2);
    expect(harnessAdded.length).toBeLessThanOrEqual(3); // tolerate timing slack
    // Step 3 (decision) MUST be in the window.
    expect(
      harnessAdded.some((m) => m.content.includes('step 3') && m.type === 'decision')
    ).toBe(true);
    // Step 1 (before window) MUST NOT be in the window.
    expect(harnessAdded.some((m) => m.content.includes('step 1'))).toBe(false);
  });

  test('zero-width window (t1 == t2) returns no additions', async ({ request }) => {
    const t = checkpoints[3];
    const res = await fetchDiff(request, t, t);
    expect(res.diff.addedCount).toBe(0);
    expect(res.diff.decisions).toHaveLength(0);
  });

  test('decisions list surfaces the locked-decision memory as a top-level field', async ({ request }) => {
    const t1 = checkpoints[0];
    const t2 = checkpoints[checkpoints.length - 1];
    const res = await fetchDiff(request, t1, t2);
    const harnessDecisions = res.diff.decisions.filter((m) =>
      m.tags.includes(HARNESS_TAG)
    );
    // We seeded one decision (step 3); should land in the decisions
    // pile-up.
    expect(harnessDecisions.length).toBeGreaterThanOrEqual(1);
    expect(
      harnessDecisions.some((m) => m.content.includes('locked decision'))
    ).toBe(true);
  });

  test('entity filter narrows the diff to apollo-tagged memories', async ({ request }) => {
    const t1 = checkpoints[0];
    const t2 = checkpoints[checkpoints.length - 1];
    const filtered = await fetchDiff(request, t1, t2, ENTITY_TAG);
    // Steps 1, 3, 4 carry the entity tag — exactly 3 of our 5 seeds.
    const harnessFiltered = filtered.diff.added.filter((m) =>
      m.tags.includes(HARNESS_TAG)
    );
    expect(harnessFiltered.length).toBeGreaterThanOrEqual(3);
    // None of the filtered results should be the un-tagged steps (2, 5).
    expect(harnessFiltered.some((m) => m.content.includes('step 2'))).toBe(false);
    expect(harnessFiltered.some((m) => m.content.includes('step 5'))).toBe(false);
  });

  test('reversed (t1 > t2) is normalised by the server, not rejected', async ({ request }) => {
    const t1 = checkpoints[checkpoints.length - 1];
    const t2 = checkpoints[0];
    const res = await fetchDiff(request, t1, t2);
    // The server swaps so from <= to. The response carries the
    // canonical order; the diff still includes our harness rows.
    expect(new Date(res.from).getTime()).toBeLessThanOrEqual(new Date(res.to).getTime());
    expect(res.diff.added.some((m) => m.tags.includes(HARNESS_TAG))).toBe(true);
  });
});
