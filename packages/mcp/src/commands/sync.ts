import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { readConfig, DEFAULT_API_BASE, DB_PATH } from '../config.js';
import { LocalStore } from '../store/local.js';
import { CloudStore } from '../store/cloud.js';
import type { CaptureInput, MemoryType, Store } from '../store/index.js';

function printLine(s: string) { process.stdout.write(s + '\n'); }
function ok(s: string) { printLine('✓ ' + s); }
function info(s: string) { printLine('  ' + s); }
function head(s: string) { printLine('\n' + s); }

// ── Frontmatter parser ──────────────────────────────────────────────────────

type FrontMatter = {
  name?: string;
  description?: string;
  type?: string;
  [key: string]: string | undefined;
};

function parseFrontmatter(raw: string): { fm: FrontMatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  const fmRaw = match[1];
  const body = match[2].trim();
  const fm: FrontMatter = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body };
}

// Maps Spine memory types (user, feedback, project, reference) → MemoryType
const TYPE_MAP: Record<string, MemoryType> = {
  user: 'fact',
  feedback: 'decision',
  project: 'context',
  reference: 'context',
};

function mapType(raw: string | undefined): MemoryType {
  if (!raw) return 'context';
  return TYPE_MAP[raw.toLowerCase()] ?? 'context';
}

// ── File discovery ──────────────────────────────────────────────────────────

async function globMemoryFiles(baseDir: string): Promise<string[]> {
  const results: string[] = [];

  let projectDirs: string[] = [];
  try {
    const entries = await readdir(baseDir);
    for (const entry of entries) {
      const full = join(baseDir, entry);
      try {
        const s = await stat(full);
        if (s.isDirectory()) projectDirs.push(full);
      } catch { /* skip */ }
    }
  } catch {
    return results;
  }

  for (const projDir of projectDirs) {
    const memDir = join(projDir, 'memory');
    try {
      const files = await readdir(memDir);
      for (const f of files) {
        if (f.endsWith('.md') && f !== 'MEMORY.md') {
          results.push(join(memDir, f));
        }
      }
    } catch { /* no memory dir */ }
  }

  return results;
}

// ── Dedup via source tag ────────────────────────────────────────────────────

function fileSourceTag(filepath: string): string {
  const hash = createHash('sha1').update(filepath).digest('hex').slice(0, 12);
  return 'spine-sync:' + hash;
}

async function alreadySynced(store: Store, sourceTag: string): Promise<boolean> {
  try {
    const recent = await store.timeline({ limit: 1000 });
    return recent.some((m) => m.source === sourceTag);
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function syncCommand(args: string[] = []): Promise<void> {
  // --obsidian-vault routes to the dedicated vault walker (handles YAML
  // arrays, wikilinks, importance frontmatter). Default behaviour stays
  // as Claude Code memory ingestion under ~/.claude/projects.
  if (args.includes('--obsidian-vault') || args.includes('--vault')) {
    const { syncObsidianCommand } = await import('./sync-obsidian.js');
    return syncObsidianCommand(args);
  }

  const dirFlagIdx = args.indexOf('--dir');
  const customDir = dirFlagIdx !== -1 ? (args[dirFlagIdx + 1] ?? '') : undefined;
  const forceFlag = args.includes('--force');
  const dryRunFlag = args.includes('--dry-run');

  const baseDir = customDir
    ? resolve(customDir)
    : join(homedir(), '.claude', 'projects');

  head('Spine sync\n──────────');
  info('Scanning: ' + baseDir);
  if (dryRunFlag) info('(dry run — nothing will be written)');

  // ── Build store ─────────────────────────────────────────────────────────
  const config = await readConfig();
  let store: Store | null = null;

  if (!dryRunFlag) {
    if (config.mode === 'cloud' && config.apiKey) {
      store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      info('Mode: cloud → ' + (config.apiBase ?? DEFAULT_API_BASE));
    } else {
      // enforceCap: false — sync imports from the user's own machine; plan caps
      // don't apply to bulk backfill from local files.
      store = new LocalStore(DB_PATH, { enforceCap: false });
      info('Mode: local → ' + DB_PATH);
    }
  }

  // ── Discover files ───────────────────────────────────────────────────────
  const files = await globMemoryFiles(baseDir);

  if (files.length === 0) {
    printLine('');
    printLine('No memory/*.md files found under ' + baseDir);
    printLine('Expected layout: ~/.claude/projects/<project>/memory/*.md');
    store?.close();
    return;
  }

  info('Found ' + files.length + ' file(s)\n');

  // ── Process each file ────────────────────────────────────────────────────
  let totalIngested = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const filepath of files) {
    const sourceTag = fileSourceTag(filepath);
    const shortPath = filepath.replace(homedir(), '~');

    if (!forceFlag && store && (await alreadySynced(store, sourceTag))) {
      info('skip  ' + shortPath + ' (already synced — use --force to re-ingest)');
      totalSkipped++;
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(filepath, 'utf8');
    } catch {
      info('skip  ' + shortPath + ' (read error)');
      totalSkipped++;
      continue;
    }

    const { fm, body } = parseFrontmatter(raw);
    if (!body.trim()) {
      info('skip  ' + shortPath + ' (empty body)');
      totalSkipped++;
      continue;
    }

    const memType = mapType(fm.type);
    const tags: string[] = ['spine-sync'];
    if (fm.type) tags.push(fm.type);

    // Build content: include name + description as context headers
    const parts: string[] = [];
    if (fm.name) parts.push('# ' + fm.name);
    if (fm.description) parts.push('> ' + fm.description);
    parts.push(body);
    const content = parts.join('\n\n');

    if (dryRunFlag) {
      info('would sync  ' + shortPath + '  [' + memType + ']  ' + content.length + ' chars');
      totalIngested++;
      continue;
    }

    const input: CaptureInput = {
      content,
      source: sourceTag,
      tags,
      type: memType,
    };

    try {
      await store!.capture(input);
      ok('sync  ' + shortPath);
      totalIngested++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      info('fail  ' + shortPath + ': ' + msg.slice(0, 120));
      totalFailed++;
    }
  }

  store?.close();

  head('Summary');
  info('Ingested: ' + totalIngested);
  info('Skipped:  ' + totalSkipped);
  if (totalFailed > 0) info('Failed:   ' + totalFailed);
  info('');
  info('Restart Claude Code and try:');
  info('  search_memory("premium upgrade protocol")');
  info('  get_context("spine terminal workflow")');
  info('');
}
