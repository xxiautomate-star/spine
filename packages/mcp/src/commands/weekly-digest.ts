/**
 * `npx @spine/mcp weekly-digest [--week=YYYY-WW] [--force]`
 *
 * Triggers the weekly multi-session digest rollup for the bearer's
 * namespace. Default target: the most recent COMPLETE ISO week (the
 * in-flight current week is never rolled up).
 *
 * Stdout: the markdown-formatted digest, paste-ready for HN/Reddit/X.
 * Exit codes:
 *   0 — ok (cached or freshly generated)
 *   1 — skipped (cap exhausted, no digests, LLM error). Stderr explains.
 *   2 — local-only install. Stderr suggests upgrade.
 */

import { DEFAULT_API_BASE, readConfig, DB_PATH } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';

function parseArgs(argv: string[]): { week?: string; force: boolean } {
  let week: string | undefined;
  let force = false;
  for (const a of argv) {
    if (a === '--force') force = true;
    else if (a.startsWith('--week=')) {
      const v = a.slice('--week='.length).trim();
      if (/^\d{4}-W\d{2}$/.test(v)) week = v;
      else throw new Error(`Invalid --week (expected YYYY-WW): ${v}`);
    }
  }
  return { week, force };
}

export async function weeklyDigestCommand(argv: string[]): Promise<void> {
  const { week, force } = parseArgs(argv);
  const config = await readConfig();

  if (config.mode === 'cloud' && config.apiKey) {
    const store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
    const result = await store.weeklyDigest({ week, force });
    if (!result.ok) {
      process.stderr.write(`weekly-digest skipped (${result.skipped})${result.error ? ': ' + result.error : ''}\n`);
      process.exit(1);
    }
    process.stdout.write(result.markdown + '\n');
    if (result.cached) process.stderr.write(`[cached row ${result.id} for week ${result.week}]\n`);
    return;
  }

  const store = new LocalStore(DB_PATH);
  try {
    const result = await store.weeklyDigest({ week, force });
    if (!result.ok) {
      process.stderr.write(`weekly-digest unsupported in local mode: ${result.error ?? result.skipped}\n`);
      process.exit(2);
    }
    process.stdout.write(result.markdown + '\n');
  } finally {
    store.close();
  }
}
