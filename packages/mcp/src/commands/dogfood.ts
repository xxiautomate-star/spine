// `spine-mcp dogfood` — same as `spine-mcp serve`, but every tool call is
// recorded to ~/.spine/dogfood.db (or the path passed via --db). Used by
// Roman to self-audit Spine in the wild before charging strangers $19/mo.
//
// The instrumented server is wire-compatible with the vanilla one; AI
// clients see no difference. The only side effect is a SQLite file that
// the diary endpoint (/api/dogfood/diary) reads for the 7-day report.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { DB_PATH, DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { getLicense } from '../license.js';
import { startServer } from '../server.js';
import type { Store } from '../store/index.js';
import { DogfoodRecorder } from '../dogfood/recorder.js';

const DEFAULT_DOGFOOD_DB = join(homedir(), '.spine', 'dogfood.db');

export async function dogfoodCommand(argv: string[]): Promise<void> {
  // Optional --db flag for the dogfood path. Default lives next to the
  // user's normal Spine state, never inside the project tree, so dogfood
  // captures don't get committed by accident.
  const dbPath = pickFlag(argv, '--db') ?? process.env.SPINE_DOGFOOD_DB ?? DEFAULT_DOGFOOD_DB;

  const cfg = await readConfig();
  const apiBase = cfg.apiBase ?? DEFAULT_API_BASE;
  const license = await getLicense({ apiKey: cfg.apiKey, apiBase });

  let store: Store;
  if (cfg.mode === 'cloud' && cfg.apiKey && license.plan !== 'free') {
    store = new CloudStore(apiBase, cfg.apiKey);
    console.error(`[spine-dogfood] cloud mode · plan=${license.plan}`);
  } else {
    store = new LocalStore(DB_PATH, { getLicenseStatus: () => license });
    console.error(`[spine-dogfood] local mode · plan=${license.plan}`);
  }

  const recorder = new DogfoodRecorder(dbPath);
  console.error(`[spine-dogfood] recording telemetry to ${dbPath}`);

  // Flush + close on shutdown so a SIGINT mid-session doesn't drop the
  // last few rows. SQLite WAL helps but explicit close is cleaner.
  const cleanup = () => {
    try {
      recorder.close();
    } catch {
      /* best-effort */
    }
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  await startServer(store, {
    onToolCall: (event) => {
      // Best-effort. recorder.record() is sync (better-sqlite3 is sync)
      // so this returns immediately; the server's onToolCall hook
      // already wraps in a Promise.resolve so we don't block the tool.
      recorder.record(event);
    },
  });
}

function pickFlag(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith(flag + '='));
  return eq ? eq.slice(flag.length + 1) : null;
}
