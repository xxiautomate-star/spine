// Gate 2 — retrieval relevance harness.
//
// Goal: prove that semantic recall surfaces the right memories at the top of
// the result list. Without this gate, "Spine remembers everything" is a
// promise without proof.
//
// Method:
//   1. Seed a dedicated test user with 200 first-person memories across
//      5 themes (40 each), tagged `recall-quality:theme:<name>`.
//      Idempotent: if the user already has 150+ such memories, skip seeding.
//   2. Run 30 evaluation queries (6 per theme) against /api/recall.
//   3. For each query, compute precision@5 — what fraction of the top 5 hits
//      carry the matching theme tag.
//   4. Average precision@5 across all 30 queries. **Fail if mean < 0.6.**
//   5. Also report recall@10 — for theme-T queries, of the (up to) 10 hits we
//      see, how many came from theme T? Reported but not asserted; the gate
//      is precision-focused because Spine surfaces a small top-K to the LLM.
//
// Tuning loop: when precision@5 falls below 0.6, the failure log prints the
// per-theme breakdown and the worst-performing queries. That points at which
// retrieval weights in lib/retrieval.ts (RRF k, decay half-life, vector vs
// BM25 balance) need adjustment.
//
// Required env (test no-ops without them — never silently passes):
//   STAGING_BASE_URL          — e.g. https://spine.xxiautomate.com
//   STAGING_RECALL_USER_KEY   — bearer token for the dedicated seed user
//
// Run locally against dev:
//   STAGING_BASE_URL=http://localhost:3000 \
//   STAGING_RECALL_USER_KEY=spine_xxx \
//   npx playwright test recall-quality.spec.ts

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  MEMORIES,
  QUERIES,
  THEME_TAG_PREFIX,
  TOTAL_MEMORIES,
  TOTAL_QUERIES,
  type Theme,
} from './fixtures/recall-quality-data';

const BASE = process.env.STAGING_BASE_URL ?? 'http://localhost:3000';
const KEY = process.env.STAGING_RECALL_USER_KEY ?? '';

const PRECISION_AT_5_THRESHOLD = 0.6;
const SEED_BATCH_SIZE = 20; // Bulk capture in batches to limit OpenAI roundtrip latency.
const MIN_SEEDED_FOR_VALID_RUN = 150; // Out of 200 — gives slack for any low-tier downgrades.

type RecallHit = {
  id: string;
  content: string;
  tags: string[];
  similarity?: number;
  fusedScore?: number;
};

function themeTag(theme: Theme): string {
  return `${THEME_TAG_PREFIX}${theme}`;
}

async function recallWith(
  request: APIRequestContext,
  query: string,
  limit: number
): Promise<RecallHit[]> {
  const res = await request.post(`${BASE}/api/recall`, {
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    data: { query, limit },
  });
  expect(res.ok(), `recall failed: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { memories?: RecallHit[] };
  return Array.isArray(body.memories) ? body.memories : [];
}

async function countSeededMemories(request: APIRequestContext): Promise<number> {
  // Use /api/recall with a deliberately broad query and a high limit. The
  // service returns at most 20, but if we get a full 20 back AND most carry a
  // theme tag, we know the seed is established. For a precise count, dashboard
  // uses /api/memories?list — but probing that endpoint shape from the test
  // is brittle. The 20-hit probe is good enough to gate seeding.
  const hits = await recallWith(request, 'Spine retrieval quality seed probe', 20);
  return hits.filter((m) => m.tags.some((t) => t.startsWith(THEME_TAG_PREFIX))).length;
}

async function seedAll(request: APIRequestContext): Promise<void> {
  for (const theme of Object.keys(MEMORIES) as Theme[]) {
    const items = MEMORIES[theme].map((content) => ({
      content,
      type: 'fact',
      tags: [themeTag(theme), 'recall-quality:seed'],
    }));
    for (let i = 0; i < items.length; i += SEED_BATCH_SIZE) {
      const batch = items.slice(i, i + SEED_BATCH_SIZE);
      const res = await request.post(`${BASE}/api/capture`, {
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        data: { bulk: batch },
      });
      expect(
        res.ok(),
        `seed failed for theme=${theme} batch=${i / SEED_BATCH_SIZE}: ${res.status()} ${await res.text()}`
      ).toBe(true);
    }
  }
}

test.describe('Gate 2 — retrieval relevance', () => {
  test.beforeAll(() => {
    if (!process.env.STAGING_BASE_URL || !process.env.STAGING_RECALL_USER_KEY) {
      throw new Error(
        'Gate 2 requires STAGING_BASE_URL + STAGING_RECALL_USER_KEY. Refusing to silent-skip.'
      );
    }
  });

  test('seed the recall-quality corpus (idempotent)', async ({ request }) => {
    test.setTimeout(120_000); // Bulk OpenAI embedding for 200 memories takes time.

    const existing = await countSeededMemories(request);
    if (existing >= MIN_SEEDED_FOR_VALID_RUN) {
      console.log(`[seed] already populated (${existing} memories tagged) — skipping`);
      return;
    }
    console.log(`[seed] only ${existing} memories present — seeding ${TOTAL_MEMORIES} total`);
    await seedAll(request);

    const after = await countSeededMemories(request);
    console.log(`[seed] post-seed probe: ${after} themed memories visible to recall`);
    expect(after, 'seeded corpus must be retrievable').toBeGreaterThanOrEqual(MIN_SEEDED_FOR_VALID_RUN);
  });

  test(`precision@5 ≥ ${PRECISION_AT_5_THRESHOLD} across ${TOTAL_QUERIES} queries`, async ({ request }) => {
    test.setTimeout(180_000);

    const perQuery: Array<{
      query: string;
      theme: Theme;
      precision5: number;
      hits: number;
      themedHits: number;
      topTags: string[];
    }> = [];
    const perTheme = new Map<Theme, { sum: number; n: number }>();

    for (const { query, theme } of QUERIES) {
      const hits = await recallWith(request, query, 10);
      const top5 = hits.slice(0, 5);
      const themedInTop5 = top5.filter((m) => m.tags.includes(themeTag(theme))).length;
      const precision5 = top5.length === 0 ? 0 : themedInTop5 / top5.length;
      const themedInTop10 = hits.filter((m) => m.tags.includes(themeTag(theme))).length;

      perQuery.push({
        query,
        theme,
        precision5,
        hits: hits.length,
        themedHits: themedInTop10,
        topTags: top5.flatMap((m) => m.tags.filter((t) => t.startsWith(THEME_TAG_PREFIX))),
      });

      const t = perTheme.get(theme) ?? { sum: 0, n: 0 };
      t.sum += precision5;
      t.n += 1;
      perTheme.set(theme, t);
    }

    const totalPrecision = perQuery.reduce((s, q) => s + q.precision5, 0);
    const meanPrecision5 = totalPrecision / perQuery.length;

    // Per-theme breakdown — useful when tuning weights.
    console.log('[precision@5 by theme]');
    for (const [theme, { sum, n }] of perTheme.entries()) {
      console.log(`  ${theme.padEnd(8)}  ${(sum / n).toFixed(3)}  (n=${n})`);
    }

    // Worst three queries — first place to look when tuning.
    const worst = [...perQuery].sort((a, b) => a.precision5 - b.precision5).slice(0, 3);
    console.log('[worst 3 queries]');
    for (const w of worst) {
      console.log(
        `  [${w.theme}] p@5=${w.precision5.toFixed(2)}  hits=${w.hits}  q="${w.query}"  topTags=${JSON.stringify(w.topTags)}`
      );
    }

    console.log(`[overall] mean precision@5 = ${meanPrecision5.toFixed(3)} (threshold ${PRECISION_AT_5_THRESHOLD})`);
    expect(meanPrecision5).toBeGreaterThanOrEqual(PRECISION_AT_5_THRESHOLD);
  });

  test('recall@10 reported (informational, no hard threshold)', async ({ request }) => {
    test.setTimeout(180_000);

    // For each theme there are 40 ground-truth memories. recall@10 = of those
    // 40, how many appear in the top-10 across the 6 queries for that theme
    // (deduped by id). Reported; not asserted — precision@5 is the gate.
    const themedRecall = new Map<Theme, Set<string>>();
    const totals = new Map<Theme, number>();

    for (const theme of Object.keys(MEMORIES) as Theme[]) {
      themedRecall.set(theme, new Set());
      totals.set(theme, MEMORIES[theme].length);
    }

    for (const { query, theme } of QUERIES) {
      const hits = await recallWith(request, query, 10);
      const seen = themedRecall.get(theme)!;
      for (const h of hits) {
        if (h.tags.includes(themeTag(theme))) seen.add(h.id);
      }
    }

    console.log('[recall@10 by theme — unique ground-truth ids found across the theme\'s 6 queries]');
    for (const theme of Object.keys(MEMORIES) as Theme[]) {
      const found = themedRecall.get(theme)!.size;
      const total = totals.get(theme)!;
      console.log(`  ${theme.padEnd(8)}  ${found}/${total}  (${((found / total) * 100).toFixed(0)}%)`);
    }
  });
});
