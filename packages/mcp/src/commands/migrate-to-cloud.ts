/**
 * `npx spine-mcp migrate-to-cloud --key SPINE_API_KEY [options]`
 *
 * One-shot backfill: drains the local SQLite memory store into the user's
 * cloud Spine archive via the public /api/capture endpoint. After a
 * successful run the local DB is renamed (kept on disk, never deleted)
 * so the user can roll back. Cloud config is rewritten so subsequent
 * `serve` invocations talk to /api directly.
 *
 * Flags:
 *   --key KEY         Cloud API key (required unless already in config).
 *   --api URL         Cloud API base. Defaults to https://spine.xxiautomate.com/api.
 *   --db PATH         Override the local DB path (defaults to ~/.spine/memories.db).
 *   --dry-run         Count rows + show first 3, do not POST anything.
 *   --batch-size N    Rows per /api/capture call. Default 50.
 *   --keep-local      Don't rename the local DB after a successful run.
 *   --force           Continue past partial-batch failures (default: stop and report).
 *
 * Exit codes:
 *   0   migration completed (or dry-run completed)
 *   1   misconfigured input (missing key, bad path, etc.)
 *   2   network or API error halted the run before completion
 */

import Database from 'better-sqlite3';
import { existsSync, renameSync } from 'node:fs';
import { DB_PATH, DEFAULT_API_BASE, readConfig, writeConfig } from '../config.js';

type Args = {
  apiKey?: string;
  apiBase: string;
  dbPath: string;
  dryRun: boolean;
  batchSize: number;
  keepLocal: boolean;
  force: boolean;
};

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string;
  type: string | null;
  created_at: string;
};

type WirePayload = {
  content: string;
  source: string | null;
  tags: string[];
  type: string;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    apiKey: get('--key'),
    apiBase: get('--api') ?? DEFAULT_API_BASE,
    dbPath: get('--db') ?? DB_PATH,
    dryRun: argv.includes('--dry-run'),
    batchSize: Math.max(1, Math.min(200, parseInt(get('--batch-size') ?? '50', 10) || 50)),
    keepLocal: argv.includes('--keep-local'),
    force: argv.includes('--force'),
  };
}

function parseTags(raw: string): string[] {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function rowToWire(r: Row): WirePayload {
  return {
    content: r.content,
    source: r.source,
    tags: parseTags(r.tags),
    type: r.type ?? 'context',
  };
}

async function postBatch(
  apiBase: string,
  apiKey: string,
  rows: WirePayload[]
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string; status: number }> {
  try {
    const body = rows.length === 1 ? rows[0] : { bulk: rows };
    const res = await fetch(`${apiBase}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, status: res.status, error: text.slice(0, 300) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = {};
    }
    const ids = Array.isArray((parsed as { ids?: unknown[] }).ids)
      ? ((parsed as { ids: unknown[] }).ids.filter((x): x is string => typeof x === 'string'))
      : typeof (parsed as { id?: unknown }).id === 'string'
      ? [(parsed as { id: string }).id]
      : [];
    return { ok: true, ids };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function info(s: string) { process.stdout.write(s + '\n'); }
function err(s: string) { process.stderr.write(s + '\n'); }

export async function migrateToCloudCommand(rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);

  // Resolve API key: --key flag wins, else fall back to existing config (so
  // a user already in cloud mode can re-run without re-typing).
  const cfg = await readConfig();
  const apiKey = args.apiKey ?? cfg.apiKey;
  if (!apiKey) {
    err('migrate-to-cloud: --key SPINE_API_KEY required (no key in ~/.spine/config.json either)');
    process.exit(1);
  }

  if (!existsSync(args.dbPath)) {
    err(`migrate-to-cloud: no local DB at ${args.dbPath} — nothing to migrate.`);
    process.exit(1);
  }

  // Open read-only — never mutate the user's local archive.
  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  let total: number;
  try {
    total = (db.prepare(`select count(*) as n from memories where deleted_at is null`).get() as { n: number }).n;
  } catch (e) {
    db.close();
    err(`migrate-to-cloud: cannot read local DB — ${(e as Error).message}`);
    process.exit(1);
  }

  info(`spine migrate-to-cloud — preparing to drain ${total} memories`);
  info(`  source : ${args.dbPath}`);
  info(`  target : ${args.apiBase}/capture`);
  info(`  batch  : ${args.batchSize}`);
  if (args.dryRun) info('  mode   : DRY RUN (no writes)');

  if (total === 0) {
    db.close();
    info('No memories to migrate. Done.');
    process.exit(0);
  }

  const select = db.prepare(
    `select id, content, source, tags, type, created_at
     from memories
     where deleted_at is null
     order by created_at asc
     limit ? offset ?`
  );

  // Dry-run: print first 3 rows and exit.
  if (args.dryRun) {
    const sample = select.all(3, 0) as Row[];
    info('\nFirst 3 rows that would be migrated:');
    for (const r of sample) {
      const preview = r.content.length > 120 ? r.content.slice(0, 120) + '…' : r.content;
      info(`  • [${r.created_at.slice(0, 10)}] ${r.type ?? 'context'} · ${preview}`);
    }
    db.close();
    info('\nDry run complete. Re-run without --dry-run to perform the migration.');
    process.exit(0);
  }

  // Live run.
  let migrated = 0;
  let failedBatches = 0;
  const startedAt = Date.now();

  for (let offset = 0; offset < total; offset += args.batchSize) {
    const rows = select.all(args.batchSize, offset) as Row[];
    if (rows.length === 0) break;

    const wire = rows.map(rowToWire);
    const result = await postBatch(args.apiBase, apiKey, wire);

    if (!result.ok) {
      failedBatches++;
      err(`  ! batch ${offset / args.batchSize + 1} failed (status ${result.status}): ${result.error}`);
      if (!args.force) {
        err('migrate-to-cloud: halting — pass --force to continue past errors.');
        db.close();
        process.exit(2);
      }
      continue;
    }

    migrated += rows.length;
    const pct = Math.floor((migrated / total) * 100);
    info(`  ✓ ${migrated}/${total} (${pct}%)`);
  }

  db.close();

  const durationS = Math.round((Date.now() - startedAt) / 1000);
  info(`\nMigration complete: ${migrated} memories sent in ${durationS}s · ${failedBatches} batch failures`);

  // Switch local config to cloud mode so subsequent `serve` calls use the
  // cloud store. Only do this if the run actually moved data (failedBatches==0
  // or --force) so a 100%-failed run doesn't silently flip the mode.
  if (migrated > 0) {
    await writeConfig({ ...cfg, mode: 'cloud', apiKey, apiBase: args.apiBase });
    info(`Config updated → cloud mode via ${args.apiBase}`);
  }

  // Rename the local DB so the user keeps a rollback point on disk.
  if (!args.keepLocal && migrated > 0) {
    const backup = args.dbPath.replace(/\.db$/, '') + `.local.bak.${timestamp()}.db`;
    try {
      renameSync(args.dbPath, backup);
      info(`Local DB renamed → ${backup}`);
      info('  (kept on disk; delete manually when you are confident in the migration)');
    } catch (e) {
      err(`Could not rename local DB — ${(e as Error).message}`);
      err('  Cloud captures from now on; local DB still present at the original path.');
    }
  }

  if (failedBatches > 0) {
    err(`\nWARNING: ${failedBatches} batch failures during the run. Compare counts on spine.xxiautomate.com/dashboard before deleting the local backup.`);
    process.exit(2);
  }

  info('\nDone. Run `spine-mcp serve` to confirm cloud mode.');
}
