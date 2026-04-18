import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '../store/local.js';

function fail(msg: string): never {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'spine-e2e-'));
  const dbPath = join(dir, 'test.db');
  const store = new LocalStore(dbPath);
  const wins: string[] = [];

  try {
    process.stdout.write('e2e: capturing 3 distinct memories (first run downloads the model)…\n');
    const ids = await store.captureBulk([
      {
        content:
          'I prefer dark mode in every application. Cream text on near-black backgrounds, always.',
        source: 'test',
      },
      {
        content:
          'My favourite drink is an oat-milk flat white, always with one sugar.',
        source: 'test',
      },
      {
        content: 'I build with Next.js 15, the App Router, and Tailwind CSS.',
        source: 'test',
      },
    ]);
    if (ids.length !== 3) fail(`expected 3 ids, got ${ids.length}`);
    wins.push('captureBulk returned 3 ids');

    process.stdout.write('e2e: recalling with coffee query…\n');
    const r1 = await store.recall('what coffee do I drink', 3);
    if (r1.length === 0) fail('no results for coffee query');
    if (!r1[0].content.toLowerCase().includes('flat white')) {
      fail(`top result was not the coffee memory: "${r1[0].content}"`);
    }
    wins.push(
      `coffee query returned coffee memory first (sim=${r1[0].similarity?.toFixed(3)})`
    );

    process.stdout.write('e2e: recalling with framework query…\n');
    const r2 = await store.recall(
      'what web framework does this project use',
      3
    );
    if (!r2[0].content.toLowerCase().includes('next.js')) {
      fail(`top result was not the Next.js memory: "${r2[0].content}"`);
    }
    wins.push(
      `framework query returned Next.js memory first (sim=${r2[0].similarity?.toFixed(3)})`
    );

    process.stdout.write('e2e: timeline returns all three…\n');
    const tl = await store.timeline({ limit: 10 });
    if (tl.length !== 3) fail(`timeline returned ${tl.length}, expected 3`);
    wins.push('timeline returned 3 memories');

    process.stdout.write('e2e: soft-delete one memory…\n');
    const ok = await store.forget(ids[0]);
    if (!ok) fail('forget returned false');
    const tl2 = await store.timeline({ limit: 10 });
    if (tl2.length !== 2) fail(`post-forget timeline returned ${tl2.length}, expected 2`);
    wins.push('soft delete hides memory from timeline');

    store.close();

    process.stdout.write('\nall passed:\n');
    for (const w of wins) process.stdout.write('  ok  ' + w + '\n');
    process.exit(0);
  } catch (err) {
    store.close();
    fail(err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
