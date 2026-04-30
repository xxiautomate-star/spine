// Gate A — real-conversation retrieval harness.
//
// Where Gate 2 (recall-quality.spec.ts) used 200 cleanly-themed synthetic
// memories, this harness ingests a 4-hour-equivalent founder-on-founder
// transcript with realistic 80/20 noise/signal mix. It then runs 20
// queries that SHOULD hit (decisions made in the transcript) and 20
// that SHOULD miss (unrelated topics).
//
// Acceptance:
//   - precision@5  ≥ 0.55  on the SHOULD_HIT set
//   - false-positive rate ≤ 0.30 on the SHOULD_MISS set
//
// FP rate is computed as: of the SHOULD_MISS query results returned in
// the top-5, what fraction carry a `harness:kind:signal` tag? Even a
// perfect retriever might return SOMETHING (the corpus is the only
// content it has access to), but it should NOT be confidently surfacing
// signal memories for topics like "chord progression for canon in D".
//
// Required env (test fails loudly if absent — never silent-skip):
//   STAGING_BASE_URL                — e.g. https://spine.xxiautomate.com
//   STAGING_DOGFOOD_USER_KEY        — bearer for a dedicated harness user
//
// Run:
//   STAGING_BASE_URL=... STAGING_DOGFOOD_USER_KEY=... \
//     npx playwright test real-conversation-harness.spec.ts

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  TRANSCRIPT_TURNS,
  SHOULD_HIT_QUERIES,
  SHOULD_MISS_QUERIES,
  PRECISION_AT_5_THRESHOLD,
  FALSE_POSITIVE_RATE_THRESHOLD,
} from './fixtures/real-conversation-corpus';

const BASE = process.env.STAGING_BASE_URL ?? 'http://localhost:3000';
const KEY = process.env.STAGING_DOGFOOD_USER_KEY ?? '';

const HARNESS_TAG = 'harness:real-conversation';
const SIGNAL_TAG = 'harness:kind:signal';
const NOISE_TAG = 'harness:kind:noise';
const SEED_BATCH = 25;
const MIN_SEEDED = 110; // out of 150 — slack for any low-tier downgrades

type RecallHit = {
  id: string;
  content: string;
  tags: string[];
};

async function recall(
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

async function probeSeedSize(request: APIRequestContext): Promise<number> {
  const hits = await recall(request, 'real-conversation harness seed probe', 20);
  return hits.filter((m) => m.tags.includes(HARNESS_TAG)).length;
}

async function seedTranscript(request: APIRequestContext): Promise<void> {
  for (let i = 0; i < TRANSCRIPT_TURNS.length; i += SEED_BATCH) {
    const batch = TRANSCRIPT_TURNS.slice(i, i + SEED_BATCH).map((turn) => ({
      content: turn.text,
      type: turn.kind === 'signal' ? 'fact' : 'context',
      tags: [HARNESS_TAG, turn.kind === 'signal' ? SIGNAL_TAG : NOISE_TAG],
    }));
    const res = await request.post(`${BASE}/api/capture`, {
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      data: { bulk: batch },
    });
    expect(
      res.ok(),
      `seed batch ${i / SEED_BATCH} failed: ${res.status()} ${await res.text()}`
    ).toBe(true);
  }
}

test.describe('Gate A — real-conversation harness', () => {
  test.beforeAll(() => {
    if (!process.env.STAGING_BASE_URL || !process.env.STAGING_DOGFOOD_USER_KEY) {
      throw new Error(
        'Real-conversation harness requires STAGING_BASE_URL + STAGING_DOGFOOD_USER_KEY. Refusing to silent-skip.'
      );
    }
  });

  test('seed the noisy transcript (idempotent)', async ({ request }) => {
    test.setTimeout(180_000);

    const existing = await probeSeedSize(request);
    if (existing >= MIN_SEEDED) {
      console.log(`[seed] already populated (${existing} harness memories) — skipping`);
      return;
    }
    console.log(`[seed] only ${existing} harness memories — seeding ${TRANSCRIPT_TURNS.length} turns`);
    await seedTranscript(request);

    const after = await probeSeedSize(request);
    console.log(`[seed] post-seed probe: ${after} harness memories visible`);
    expect(after, 'seeded corpus must be retrievable').toBeGreaterThanOrEqual(MIN_SEEDED);
  });

  test(`precision@5 on SHOULD_HIT queries ≥ ${PRECISION_AT_5_THRESHOLD}`, async ({ request }) => {
    test.setTimeout(180_000);

    let totalP5 = 0;
    const perQuery: Array<{ query: string; precision5: number; topTags: string[] }> = [];

    for (const query of SHOULD_HIT_QUERIES) {
      const hits = await recall(request, query, 5);
      const top5 = hits.slice(0, 5);
      const signalInTop5 = top5.filter((m) => m.tags.includes(SIGNAL_TAG)).length;
      const p5 = top5.length === 0 ? 0 : signalInTop5 / top5.length;
      totalP5 += p5;
      perQuery.push({
        query,
        precision5: p5,
        topTags: top5.flatMap((m) => m.tags.filter((t) => t.startsWith('harness:kind:'))),
      });
    }

    const meanP5 = totalP5 / SHOULD_HIT_QUERIES.length;

    console.log(`[precision@5] mean = ${meanP5.toFixed(3)} (threshold ${PRECISION_AT_5_THRESHOLD})`);

    // Worst offenders — first place to look when tuning weights.
    const worst = [...perQuery].sort((a, b) => a.precision5 - b.precision5).slice(0, 3);
    console.log('[worst SHOULD_HIT queries]');
    for (const w of worst) {
      console.log(`  p@5=${w.precision5.toFixed(2)}  q="${w.query}"  topTags=${JSON.stringify(w.topTags)}`);
    }

    expect(meanP5).toBeGreaterThanOrEqual(PRECISION_AT_5_THRESHOLD);
  });

  test(`false-positive rate on SHOULD_MISS queries ≤ ${FALSE_POSITIVE_RATE_THRESHOLD}`, async ({ request }) => {
    test.setTimeout(180_000);

    let totalSlots = 0;
    let signalSurfaces = 0;
    const perQuery: Array<{ query: string; signalCount: number; topCount: number }> = [];

    for (const query of SHOULD_MISS_QUERIES) {
      const hits = await recall(request, query, 5);
      const top5 = hits.slice(0, 5);
      const signalCount = top5.filter((m) => m.tags.includes(SIGNAL_TAG)).length;
      totalSlots += top5.length;
      signalSurfaces += signalCount;
      perQuery.push({ query, signalCount, topCount: top5.length });
    }

    // FP rate: of all "result slots" served on SHOULD_MISS queries, what
    // fraction were signal-tagged. A retriever that returns 0 hits on
    // unrelated topics scores 0 here. A retriever that confidently
    // surfaces 5 signal memories for "best yoga poses" scores 1.
    const fpRate = totalSlots === 0 ? 0 : signalSurfaces / totalSlots;

    console.log(`[FP rate] ${fpRate.toFixed(3)} (threshold ${FALSE_POSITIVE_RATE_THRESHOLD}) — ${signalSurfaces}/${totalSlots} slots`);

    const worst = [...perQuery].sort((a, b) => b.signalCount - a.signalCount).slice(0, 3);
    console.log('[worst SHOULD_MISS queries — most signal leakage]');
    for (const w of worst) {
      console.log(`  signal=${w.signalCount}/${w.topCount}  q="${w.query}"`);
    }

    expect(fpRate).toBeLessThanOrEqual(FALSE_POSITIVE_RATE_THRESHOLD);
  });
});
