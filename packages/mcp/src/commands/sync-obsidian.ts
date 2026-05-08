/**
 * Obsidian vault → Spine ingestion.
 *
 * Selected from `sync` via `--obsidian-vault <path>`. Walks the vault
 * recursively, parses Obsidian-flavoured frontmatter (YAML arrays for
 * tags/aliases, wikilinks lifted into searchable tags, importance from
 * frontmatter), then captures each note as one Spine memory.
 *
 * Idempotent: re-runs skip files whose source-tag already exists with a
 * created_at >= the file's mtime. When the file has been edited since the
 * last sync (mtime > prior.createdAt), the prior memory is forgotten before
 * the new copy is captured — so one note maps to exactly one memory in the
 * archive, no matter how many times you sync. `--force` re-ingests every
 * note unconditionally, dropping the prior copy.
 *
 * Spec: docs/OBSIDIAN.md.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readConfig, DB_PATH, DEFAULT_API_BASE } from '../config.js';
import { LocalStore } from '../store/local.js';
import { CloudStore } from '../store/cloud.js';
import type { CaptureInput, MemoryType, Store } from '../store/index.js';

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_IGNORES = [
  'Daily Notes',
  'Daily',
  'Templates',
  '_Spine',
  '.obsidian',
  '.trash',
];
const MAX_FILE_BYTES = 256 * 1024;
const VALID_TYPES = new Set<MemoryType>(['decision', 'bug', 'feature', 'context', 'fact']);

// ── CLI ─────────────────────────────────────────────────────────────────────

type Options = {
  vaultRoot: string;
  dryRun: boolean;
  force: boolean;
  ignores: string[];          // path prefixes relative to vault root
  includes: string[];         // override-includes (re-allow paths from DEFAULT_IGNORES)
};

function printLine(s: string) { process.stdout.write(s + '\n'); }
function ok(s: string)  { printLine('✓ ' + s); }
function info(s: string) { printLine('  ' + s); }
function head(s: string) { printLine('\n' + s); }

// ── Frontmatter parser (handles YAML arrays and quoted strings) ─────────────

type Frontmatter = {
  tags?: string[];
  aliases?: string[];
  type?: string;
  importance?: 'high' | 'standard' | 'low';
  created?: string;
  updated?: string;
  extra: Record<string, string>;
};

function parseObsidianFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const empty: Frontmatter = { extra: {} };
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: empty, body: raw };

  const yaml = match[1];
  const body = match[2];
  const fm: Frontmatter = { extra: {} };

  for (const line of yaml.split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, valueRaw] = kv;
    const value = valueRaw.trim();

    if (key === 'tags' || key === 'aliases') {
      const arrMatch = value.match(/^\[(.*)\]$/);
      const list = arrMatch
        ? arrMatch[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : value.length > 0
        ? value.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [];
      if (key === 'tags') fm.tags = list;
      else fm.aliases = list;
    } else if (key === 'type' && VALID_TYPES.has(value.toLowerCase() as MemoryType)) {
      fm.type = value.toLowerCase();
    } else if (key === 'importance' && (value === 'high' || value === 'standard' || value === 'low')) {
      fm.importance = value;
    } else if (key === 'created' || key === 'updated') {
      fm[key] = value.replace(/^["']|["']$/g, '');
    } else {
      // Free-form metadata becomes a searchable tag at ingest time.
      fm.extra[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return { fm, body };
}

// ── Wikilink extraction ─────────────────────────────────────────────────────

function extractWikilinks(body: string): { embeds: string[]; links: string[] } {
  const embeds = new Set<string>();
  const links = new Set<string>();
  // ![[embed]] runs first so it doesn't double-count as a link.
  const embedRe = /!\[\[([^\]\n|]+?)(?:\|[^\]\n]+)?\]\]/g;
  const linkRe = /(?<!!)\[\[([^\]\n|]+?)(?:\|[^\]\n]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = embedRe.exec(body)) !== null) embeds.add(m[1].trim());
  while ((m = linkRe.exec(body)) !== null) links.add(m[1].trim());
  return { embeds: [...embeds], links: [...links] };
}

// ── File walker ─────────────────────────────────────────────────────────────

async function walkVault(root: string, opts: Pick<Options, 'ignores' | 'includes'>): Promise<string[]> {
  const out: string[] = [];

  const isIgnored = (rel: string): boolean => {
    if (opts.includes.some((p) => rel === p || rel.startsWith(p + '/'))) return false;
    return opts.ignores.some((p) => rel === p || rel.startsWith(p + '/'));
  };

  async function recurse(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(root, full);
      if (isIgnored(rel)) continue;
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        await recurse(full);
      } else if (s.isFile() && entry.toLowerCase().endsWith('.md')) {
        if (s.size > MAX_FILE_BYTES) continue;
        out.push(full);
      }
    }
  }

  await recurse(root);
  return out.sort();
}

// ── Per-file dedup ──────────────────────────────────────────────────────────

function vaultSourceTag(vaultRoot: string, filepath: string): string {
  const rel = relative(vaultRoot, filepath);
  const hash = createHash('sha1').update(rel).digest('hex').slice(0, 12);
  return 'obsidian-sync:' + hash;
}

type PriorMemory = { id: string; createdAt: string };

async function findPriorMemory(store: Store, sourceTag: string): Promise<PriorMemory | null> {
  try {
    const recent = await store.timeline({ limit: 5000 });
    const hit = recent.find((m) => m.source === sourceTag);
    return hit ? { id: hit.id, createdAt: hit.createdAt } : null;
  } catch {
    return null;
  }
}

// ── Build a CaptureInput from a parsed note ────────────────────────────────

function buildInput(
  vaultRoot: string,
  filepath: string,
  raw: string,
  mtimeIso: string
): CaptureInput | null {
  const { fm, body } = parseObsidianFrontmatter(raw);
  const trimmed = body.trim();
  if (!trimmed) return null;

  const tags: string[] = ['obsidian'];
  for (const t of fm.tags ?? []) tags.push(t);
  for (const a of fm.aliases ?? []) tags.push('alias:' + a);
  for (const [k, v] of Object.entries(fm.extra)) tags.push(`${k}:${v}`);

  const { embeds, links } = extractWikilinks(trimmed);
  for (const l of links) tags.push('link:' + l);
  for (const e of embeds) tags.push('embed:' + e);

  const memType: MemoryType = (fm.type && VALID_TYPES.has(fm.type as MemoryType))
    ? (fm.type as MemoryType)
    : 'context';

  const rel = relative(vaultRoot, filepath);
  const header = `# ${rel}`;
  const content = `${header}\n\n${trimmed}`;

  const input: CaptureInput = {
    content,
    source: vaultSourceTag(vaultRoot, filepath),
    tags: [...new Set(tags)],
    type: memType,
  };
  if (fm.importance) input.importance = fm.importance;

  // Note: created_at on the cloud is set at write time. Using fm.created or
  // mtime would require an extra column on /api/capture; left as a v2.
  void mtimeIso;
  return input;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function syncObsidianCommand(rawArgs: string[]): Promise<void> {
  const get = (flag: string): string | undefined => {
    const i = rawArgs.indexOf(flag);
    return i !== -1 ? rawArgs[i + 1] : undefined;
  };
  const allValues = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      if (rawArgs[i] === flag && rawArgs[i + 1]) out.push(rawArgs[i + 1]);
    }
    return out;
  };

  const vaultArg = get('--obsidian-vault') ?? get('--vault');
  if (!vaultArg) {
    process.stderr.write('sync --obsidian-vault: missing vault path.\n');
    process.exit(1);
  }
  const vaultRoot = resolve(vaultArg.replace(/^~(\/|$)/, homedir() + '$1'));

  const opts: Options = {
    vaultRoot,
    dryRun: rawArgs.includes('--dry-run'),
    force: rawArgs.includes('--force'),
    ignores: [...DEFAULT_IGNORES, ...allValues('--ignore')],
    includes: allValues('--include'),
  };

  head('Spine sync — Obsidian vault\n────────────────────────────');
  info('Vault: ' + vaultRoot);
  info('Ignoring: ' + opts.ignores.join(', '));
  if (opts.includes.length > 0) info('Force-include: ' + opts.includes.join(', '));
  if (opts.dryRun) info('(dry run — nothing will be written)');

  let s;
  try {
    s = await stat(vaultRoot);
  } catch {
    process.stderr.write(`sync --obsidian-vault: ${vaultRoot} not found.\n`);
    process.exit(1);
  }
  if (!s.isDirectory()) {
    process.stderr.write(`sync --obsidian-vault: ${vaultRoot} is not a directory.\n`);
    process.exit(1);
  }

  const files = await walkVault(vaultRoot, opts);
  info('Found ' + files.length + ' note(s)\n');
  if (files.length === 0) {
    info('Nothing to ingest.');
    return;
  }

  const config = await readConfig();
  let store: Store | null = null;
  if (!opts.dryRun) {
    if (config.mode === 'cloud' && config.apiKey) {
      store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      info('Mode: cloud → ' + (config.apiBase ?? DEFAULT_API_BASE));
    } else {
      store = new LocalStore(DB_PATH, { enforceCap: false });
      info('Mode: local → ' + DB_PATH);
    }
  }

  let ingested = 0, updated = 0, skipped = 0, failed = 0;

  for (const filepath of files) {
    const rel = relative(vaultRoot, filepath);
    const sourceTag = vaultSourceTag(vaultRoot, filepath);

    let mtimeIso: string;
    try {
      const fileStat = await stat(filepath);
      mtimeIso = fileStat.mtime.toISOString();
    } catch {
      info('skip  ' + rel + ' (stat error)');
      skipped++;
      continue;
    }

    const prior = store ? await findPriorMemory(store, sourceTag) : null;
    if (prior && !opts.force && prior.createdAt >= mtimeIso) {
      info('skip  ' + rel + ' (already synced)');
      skipped++;
      continue;
    }

    let raw: string;
    try {
      raw = await readFile(filepath, 'utf8');
    } catch {
      info('skip  ' + rel + ' (read error)');
      skipped++;
      continue;
    }

    const input = buildInput(vaultRoot, filepath, raw, mtimeIso);
    if (!input) {
      info('skip  ' + rel + ' (empty body)');
      skipped++;
      continue;
    }

    if (opts.dryRun) {
      const verb = prior ? 'would update' : 'would sync  ';
      info(verb + '  ' + rel + '  [' + input.type + ']  ' + input.content.length + ' chars · ' + (input.tags?.length ?? 0) + ' tags');
      ingested++;
      continue;
    }

    // True update semantics: drop the prior copy before capturing the new
    // one so each note maps to exactly one memory after re-syncs.
    if (prior && store) {
      try {
        await store.forget(prior.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        info('warn  ' + rel + ' (could not drop prior ' + prior.id.slice(0, 8) + ': ' + msg.slice(0, 80) + ')');
      }
    }

    try {
      await store!.capture(input);
      if (prior) {
        ok('update  ' + rel);
        updated++;
      } else {
        ok('sync  ' + rel);
        ingested++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      info('fail  ' + rel + ': ' + msg.slice(0, 120));
      failed++;
    }
  }

  store?.close();

  head('Summary');
  info('Ingested: ' + ingested);
  if (updated > 0) info('Updated:  ' + updated);
  info('Skipped:  ' + skipped);
  if (failed > 0) info('Failed:   ' + failed);
  info('');
  info('Restart Claude Code and try:');
  info('  search_memory("design pattern")     — across the whole vault');
  info('  search_memory("link:OAuth bug")     — find every note that linked to that page');
  info('');
}
