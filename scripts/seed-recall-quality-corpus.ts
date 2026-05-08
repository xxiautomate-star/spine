#!/usr/bin/env -S npx tsx
/**
 * Seed the recall-quality benchmark corpus into prod.
 *
 * /proof reads the latest row from benchmark_runs and the cron at
 * vercel.json `0 2 * * *` IS firing — but it produces precision=0,
 * recall=0 because no test user has the 200-memory eval corpus
 * loaded into spine_memories. This script fixes that, end-to-end:
 *
 *   1. Sign up a test user at https://spine.xxiautomate.com/login
 *      (use an inbox you control: spine-bench@xxiautomate.com or
 *      a +alias on your real address).
 *   2. Generate an API key in /dashboard/keys.
 *   3. Run: SPINE_API_KEY=spine_live_xxx npx tsx scripts/seed-recall-quality-corpus.ts
 *      Optional: SPINE_API=https://spine.xxiautomate.com (default)
 *   4. Set Vercel env HARNESS_API_KEY to the same key.
 *   5. Trigger the cron once to verify:
 *      curl -X POST $SPINE_API/api/cron/benchmarks \
 *           -H "Authorization: Bearer $CRON_SECRET"
 *   6. /proof should now show non-zero precision and the calibration
 *      fallback should disengage automatically.
 *
 * The script is idempotent at the API level — re-running double-writes
 * (capture is append-only by design). Run once. If you need to re-seed
 * a different test user, generate a new key and run for that user.
 *
 * Memories are POSTed in batches of 10 to the public /api/capture
 * endpoint with the user's key. No service-role credentials needed.
 */

import { MEMORIES, THEME_TAG_PREFIX, TOTAL_MEMORIES, type Theme } from '../tests/fixtures/recall-quality-data.js';

const API_KEY_RAW = process.env.SPINE_API_KEY;
const API_BASE = process.env.SPINE_API ?? 'https://spine.xxiautomate.com';

if (!API_KEY_RAW) {
  console.error('Missing env: SPINE_API_KEY (mint at /dashboard/keys, must be the test user, not yours).');
  process.exit(1);
}
if (!API_KEY_RAW.startsWith('spine_live_')) {
  console.error(`SPINE_API_KEY does not look like a Spine API key (expected spine_live_… prefix).`);
  process.exit(1);
}
const API_KEY: string = API_KEY_RAW;

type BulkItem = { content: string; tags: string[]; type: 'fact' };

async function postBulk(items: BulkItem[]): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${API_BASE}/api/capture`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ bulk: items }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  console.log(`Seeding recall-quality corpus → ${API_BASE}`);
  console.log(`Total memories to seed: ${TOTAL_MEMORIES}`);
  console.log();

  const themes: Theme[] = ['tech', 'travel', 'cooking', 'fitness', 'books'];
  let written = 0;
  let failed = 0;

  for (const theme of themes) {
    const memories = MEMORIES[theme];
    console.log(`▶ ${theme} (${memories.length} memories)`);

    // Batch size 10 keeps each POST under the 5MB Vercel body cap and
    // lets the burst rate-limit (120/min/user) breathe — 200 memories
    // in 20 batches with a 500ms pause = ~10s total.
    const BATCH = 10;
    for (let i = 0; i < memories.length; i += BATCH) {
      const slice = memories.slice(i, i + BATCH);
      const items: BulkItem[] = slice.map((content) => ({
        content,
        tags: [`${THEME_TAG_PREFIX}${theme}`, 'recall-quality-fixture'],
        type: 'fact',
      }));
      const { ok, status, body } = await postBulk(items);
      if (!ok) {
        failed += items.length;
        console.log(`  ✗ batch ${i / BATCH + 1} failed (${status}): ${body.slice(0, 200)}`);
      } else {
        written += items.length;
        process.stdout.write(`  ✓ batch ${i / BATCH + 1} (${written}/${TOTAL_MEMORIES})\r`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log();
  }

  console.log();
  console.log('───────────────────────────────────');
  console.log(`Written: ${written} / ${TOTAL_MEMORIES}`);
  if (failed > 0) console.log(`Failed:  ${failed}`);
  console.log();
  console.log('Next steps:');
  console.log(`  1. Set Vercel env HARNESS_API_KEY=${API_KEY.slice(0, 16)}… (the key you used here).`);
  console.log(`  2. Trigger one cron run:`);
  console.log(`       curl -X POST ${API_BASE}/api/cron/benchmarks \\`);
  console.log(`            -H "Authorization: Bearer \$CRON_SECRET"`);
  console.log(`  3. Re-load /proof. Should show non-zero precision now.`);
  console.log(`  4. /api/health → launch_gates.corpus_seeded should flip true.`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
