import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cosine } from '../embed/index.js';
import { localEmbedder } from '../embed/local.js';
import { getLicense, type LicenseStatus } from '../license.js';
import type {
  CaptureInput,
  DigestPayload,
  HygieneSummary,
  Memory,
  RecallRecentResult,
  Store,
  TimelineOpts,
  TurnInput,
  UsageStats,
  WeeklyDigestResult,
} from './index.js';

/**
 * Raised when a write would exceed the plan cap. The CLI / MCP server
 * converts this into a structured `plan_upgrade_required` response that
 * includes the upgrade URL.
 */
export class PlanLimitError extends Error {
  readonly code = 'plan_upgrade_required';
  constructor(
    readonly plan: string,
    readonly used: number,
    readonly cap: number,
    readonly upgradeUrl: string,
  ) {
    super(
      `Plan limit reached (${used}/${cap} memories on ${plan}). ` +
        `Upgrade at ${upgradeUrl} to continue capturing.`,
    );
    this.name = 'PlanLimitError';
  }
}

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string;
  type: string | null;
  embedding: Buffer;
  created_at: string;
  deleted_at: string | null;
};

function toFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function fromFloat32(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export type LocalStoreOpts = {
  /**
   * Called before every write to resolve the current plan + cap. Keeping
   * this as a thunk (instead of a static value) lets the serve command
   * refresh the license on a schedule without rebuilding the store.
   */
  getLicenseStatus?: () => LicenseStatus | Promise<LicenseStatus>;
  /**
   * Opt out of cap enforcement entirely — used by tests and the bulk
   * import path where the caller has already checked headroom.
   */
  enforceCap?: boolean;
};

export class LocalStore implements Store {
  private db: Database.Database;
  private readonly getLicenseStatus: () => LicenseStatus | Promise<LicenseStatus>;
  private readonly enforceCap: boolean;

  constructor(dbPath: string, opts: LocalStoreOpts = {}) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists memories (
        id          text primary key,
        content     text not null,
        source      text,
        tags        text not null default '[]',
        type        text not null default 'context',
        embedding   blob not null,
        created_at  text not null,
        deleted_at  text,
        check (type in ('decision','bug','feature','context','fact'))
      );
      create index if not exists memories_created_idx
        on memories (created_at desc);
    `);
    // Migrate existing DBs without the type column
    try {
      this.db.exec("alter table memories add column type text not null default 'context'");
    } catch { /* column already exists */ }

    // FTS5 virtual table for BM25 full-text search
    this.db.exec(`
      create virtual table if not exists memories_fts using fts5(
        id unindexed,
        content,
        tokenize='porter unicode61'
      );
    `);
    // Keep FTS5 in sync with the main table
    this.db.exec(`
      create trigger if not exists memories_ai after insert on memories begin
        insert into memories_fts(id, content) values (new.id, new.content);
      end;
      create trigger if not exists memories_ad after delete on memories begin
        delete from memories_fts where id = old.id;
      end;
      create trigger if not exists memories_au after update of content on memories begin
        delete from memories_fts where id = old.id;
        insert into memories_fts(id, content) values (new.id, new.content);
      end;
    `);
    // Backfill existing rows not yet in FTS5
    this.db.exec(`
      insert or ignore into memories_fts(id, content)
      select id, content from memories where deleted_at is null
        and id not in (select id from memories_fts);
    `);
    this.getLicenseStatus =
      opts.getLicenseStatus ??
      (async () => getLicense({ apiKey: undefined }));
    this.enforceCap = opts.enforceCap !== false;
  }

  /** Count non-deleted memories. Cheap — runs off the PK index. */
  private liveCount(): number {
    const row = this.db
      .prepare('select count(*) as c from memories where deleted_at is null')
      .get() as { c: number };
    return row.c ?? 0;
  }

  private async assertHeadroom(want: number): Promise<LicenseStatus> {
    const status = await this.getLicenseStatus();
    if (!this.enforceCap) return status;
    if (status.cap === null) return status;
    const used = this.liveCount();
    if (used + want > status.cap) {
      throw new PlanLimitError(status.plan, used, status.cap, status.upgradeUrl);
    }
    return status;
  }

  async capture(input: CaptureInput): Promise<string> {
    await this.assertHeadroom(1);
    const vec = await localEmbedder.embed(input.content);
    const id = randomUUID();
    this.db
      .prepare(
        'insert into memories (id, content, source, tags, type, embedding, created_at) values (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        input.content,
        input.source ?? null,
        JSON.stringify(input.tags ?? []),
        input.type ?? 'context',
        fromFloat32(vec),
        new Date().toISOString()
      );
    return id;
  }

  async captureBulk(inputs: CaptureInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    await this.assertHeadroom(inputs.length);
    const vecs = await localEmbedder.embedBatch(inputs.map((i) => i.content));
    const ids: string[] = [];
    const stmt = this.db.prepare(
      'insert into memories (id, content, source, tags, type, embedding, created_at) values (?, ?, ?, ?, ?, ?, ?)'
    );
    const tx = this.db.transaction(() => {
      for (let i = 0; i < inputs.length; i++) {
        const id = randomUUID();
        ids.push(id);
        stmt.run(
          id,
          inputs[i].content,
          inputs[i].source ?? null,
          JSON.stringify(inputs[i].tags ?? []),
          inputs[i].type ?? 'context',
          fromFloat32(vecs[i]),
          new Date().toISOString()
        );
      }
    });
    tx();
    return ids;
  }

  async recall(query: string, limit: number): Promise<Memory[]> {
    const pool = Math.min(limit * 3 + 50, 200);

    // ── Semantic search ──────────────────────────────────────────────────────
    const qvec = await localEmbedder.embed(query);
    const allRows = this.db
      .prepare('select * from memories where deleted_at is null')
      .all() as Row[];

    const semScored = allRows
      .filter((r) => r.embedding && r.embedding.length > 0)
      .map((r) => ({ row: r, sim: cosine(qvec, toFloat32(r.embedding)) }));
    semScored.sort((a, b) => b.sim - a.sim);
    const semTop = semScored.slice(0, pool);

    const semRanks = new Map<string, number>();
    semTop.forEach(({ row }, i) => semRanks.set(row.id, i + 1));

    const simMap = new Map<string, number>();
    for (const { row, sim } of semScored) simMap.set(row.id, sim);

    // ── BM25 search via FTS5 ─────────────────────────────────────────────────
    const bm25Ranks = new Map<string, number>();
    try {
      const ftsQuery = query.replace(/['"*^()[\]{}:=<>!]/g, ' ').replace(/\s+/g, ' ').trim();
      if (ftsQuery) {
        const bm25Rows = this.db
          .prepare('select id from memories_fts where memories_fts match ? order by rank limit ?')
          .all(ftsQuery, pool) as { id: string }[];
        bm25Rows.forEach((r, i) => bm25Ranks.set(r.id, i + 1));
      }
    } catch { /* FTS5 unavailable or invalid query token */ }

    // ── RRF fusion ───────────────────────────────────────────────────────────
    const K = 60;
    const allIds = new Set([...semRanks.keys(), ...bm25Ranks.keys()]);

    // Ensure BM25-only candidates have their row data
    const rowMap = new Map<string, Row>(allRows.map((r) => [r.id, r]));
    for (const id of bm25Ranks.keys()) {
      if (!rowMap.has(id)) {
        const r = this.db.prepare('select * from memories where id = ?').get(id) as Row | undefined;
        if (r) rowMap.set(id, r);
      }
    }

    // ── Recency decay (90-day half-life, same as cloud retrieval.ts) ─────────
    const now = Date.now();
    const decayTau = 90 / Math.LN2;

    const candidates: { row: Row; finalScore: number }[] = [];
    for (const id of allIds) {
      const row = rowMap.get(id);
      if (!row) continue;
      const sr = semRanks.get(id) ?? 1000;
      const br = bm25Ranks.get(id) ?? 1000;
      const rrf = 1 / (K + sr) + 1 / (K + br);
      const ageDays = (now - new Date(row.created_at).getTime()) / 86_400_000;
      const decay = Math.exp(-ageDays / decayTau);
      candidates.push({ row, finalScore: rrf * decay });
    }
    candidates.sort((a, b) => b.finalScore - a.finalScore);
    const top50 = candidates.slice(0, 50);

    // ── MMR deduplication (threshold 0.85) ───────────────────────────────────
    const selected: { row: Row }[] = [];
    const selectedEmbeddings: Float32Array[] = [];

    for (const candidate of top50) {
      if (selected.length >= limit) break;
      if (!candidate.row.embedding || candidate.row.embedding.length === 0) {
        selected.push(candidate);
        continue;
      }
      const candEmb = toFloat32(candidate.row.embedding);
      const maxSim = selectedEmbeddings.length > 0
        ? Math.max(...selectedEmbeddings.map((e) => cosine(candEmb, e)))
        : 0;
      if (maxSim < 0.85) {
        selected.push(candidate);
        selectedEmbeddings.push(candEmb);
      }
    }

    return selected.map(({ row }) => ({
      id: row.id,
      content: row.content,
      source: row.source,
      tags: safeParse(row.tags),
      type: (row.type ?? 'context') as import('./index.js').MemoryType,
      createdAt: row.created_at,
      similarity: simMap.get(row.id),
    }));
  }

  async timeline(opts: TimelineOpts): Promise<Memory[]> {
    const params: unknown[] = [];
    let sql = 'select * from memories where deleted_at is null';
    if (opts.from) {
      sql += ' and created_at >= ?';
      params.push(opts.from);
    }
    if (opts.to) {
      sql += ' and created_at <= ?';
      params.push(opts.to);
    }
    if (opts.type) {
      sql += ' and type = ?';
      params.push(opts.type);
    }
    sql += ' order by created_at desc limit ?';
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      tags: safeParse(r.tags),
      type: (r.type ?? 'context') as import('./index.js').MemoryType,
      createdAt: r.created_at,
    }));
  }

  async replay(path: string, limit: number): Promise<Memory[]> {
    const cap = Math.max(1, Math.min(200, limit));
    // Keyword scan — content mentions the filename or directory
    const filename = path.split(/[/\\]/).pop() ?? path;
    const keyRows = this.db
      .prepare(
        "select * from memories where deleted_at is null and (content like ? or content like ?) order by created_at asc limit ?"
      )
      .all(`%${filename}%`, `%${path}%`, cap) as Row[];

    // Semantic scan
    let semRows: Row[] = [];
    try {
      const qvec = await localEmbedder.embed(`decisions, bugs, and context for file: ${path}`);
      const allRows = this.db
        .prepare('select * from memories where deleted_at is null')
        .all() as Row[];
      const scored = allRows.map((r) => ({
        row: r,
        sim: cosine(qvec, toFloat32(r.embedding)),
      }));
      scored.sort((a, b) => b.sim - a.sim);
      semRows = scored.filter(({ sim }) => sim >= 0.55).slice(0, cap).map(({ row }) => row);
    } catch { /* embedder unavailable */ }

    // Merge + deduplicate
    const seen = new Set<string>();
    const merged: Row[] = [];
    for (const r of [...keyRows, ...semRows]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    // Sort chronologically ASC — oldest first to read as a narrative
    merged.sort((a, b) => a.created_at.localeCompare(b.created_at));

    return merged.slice(0, cap).map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      tags: safeParse(r.tags),
      type: (r.type ?? 'context') as import('./index.js').MemoryType,
      createdAt: r.created_at,
    }));
  }

  async captureTurn(input: TurnInput): Promise<string> {
    const tags = ['session-turn', `session:${input.sessionId.slice(0, 8)}`, `role:${input.role}`];
    if (input.toolName) tags.push(`tool:${input.toolName}`);
    return this.capture({
      content: `[${input.role}${input.toolName ? `:${input.toolName}` : ''}] ${input.content}`,
      source: input.source ?? 'claude-code',
      tags,
      type: 'context',
    });
  }

  async captureDigest(input: DigestPayload): Promise<string> {
    const body = JSON.stringify(
      {
        decisions: input.decisions ?? [],
        state: input.state ?? '',
        open_threads: input.openThreads ?? [],
        mistakes: input.mistakes ?? [],
        files_touched: input.filesTouched ?? [],
        commits: input.commits ?? [],
      },
      null,
      2
    );
    return this.capture({
      content: body,
      source: input.source ?? 'claude-code',
      tags: ['session-digest', `session:${input.sessionId.slice(0, 8)}`, 'digest'],
      type: 'context',
    });
  }

  /**
   * Local-mode recall-recent: scans tags via JSON LIKE rather than indexed
   * columns. Fine for the volumes a single-user local SQLite holds.
   * Prioritises digests (always include all that fit), then turns of the
   * most recent session reverse-chronologically.
   */
  async recallRecent(maxTokens: number): Promise<RecallRecentResult> {
    const charBudget = Math.max(800, maxTokens * 4 - 200);

    const digestRows = this.db
      .prepare(
        "select * from memories where deleted_at is null and tags like '%\"digest\"%' order by created_at desc limit 3"
      )
      .all() as Row[];

    const latest = this.db
      .prepare(
        "select tags, created_at from memories where deleted_at is null and tags like '%\"session:%' order by created_at desc limit 1"
      )
      .get() as { tags: string; created_at: string } | undefined;
    const latestSessionTag = latest ? extractSessionTag(safeParse(latest.tags)) : null;

    let turnRows: Row[] = [];
    if (latestSessionTag) {
      const pattern = `%"${latestSessionTag}"%`;
      turnRows = this.db
        .prepare(
          "select * from memories where deleted_at is null and tags like ? and tags like '%\"session-turn\"%' order by created_at desc limit 50"
        )
        .all(pattern) as Row[];
    }

    const sectionLines: string[] = [];
    const includedSessions = new Set<string>();
    let used = 0;

    if (digestRows.length > 0) {
      sectionLines.push('## Recent session digests', '');
      let kept = 0;
      for (const d of digestRows) {
        const date = d.created_at.slice(0, 10);
        const session = extractSessionTag(safeParse(d.tags)) ?? 'unknown';
        const line = `- [${date} · ${session}]\n${d.content}`;
        const cost = line.length + 2;
        if (used + cost > charBudget && kept > 0) {
          const remaining = digestRows.length - kept;
          sectionLines.push(`- [${remaining} more digest${remaining === 1 ? '' : 's'} truncated, query timeline for full]`);
          used += 80;
          break;
        }
        sectionLines.push(line);
        used += cost;
        kept += 1;
        if (session !== 'unknown') includedSessions.add(session);
      }
      sectionLines.push('');
    }

    if (latestSessionTag && turnRows.length > 0) {
      const headerLine = `## Most recent session — ${turnRows.length} turn${turnRows.length === 1 ? '' : 's'} (${latestSessionTag})`;
      sectionLines.push(headerLine, '');
      used += headerLine.length + 2;

      let turnsKept = 0;
      for (const t of turnRows) {
        const time = t.created_at.slice(11, 16);
        const line = `${time} ${t.content}`;
        const cost = line.length + 2;
        if (used + cost > charBudget) break;
        used += cost;
        turnsKept += 1;
      }
      if (turnsKept > 0) {
        const kept = turnRows.slice(0, turnsKept).reverse();
        for (const t of kept) {
          const time = t.created_at.slice(11, 16);
          sectionLines.push(`${time} ${t.content}`);
        }
        includedSessions.add(latestSessionTag);
        if (turnsKept < turnRows.length) {
          const dropped = turnRows.length - turnsKept;
          sectionLines.push('', `[${dropped} earlier turn${dropped === 1 ? '' : 's'} truncated to fit token budget]`);
        }
      } else {
        sectionLines.splice(-2, 2);
      }
    }

    const header = '# Spine — recent context';
    const context =
      sectionLines.length === 0
        ? `${header}\n\n(no recent sessions yet — capture some turns and try again)`
        : `${header}\n\n${sectionLines.join('\n').trim()}`;

    return { context, sessionsRecalled: includedSessions.size };
  }

  /**
   * Local-mode weekly digest is intentionally a no-op: the rollup needs
   * an Anthropic API call which a local-only install doesn't have wired.
   * We return a structured skip rather than crash so callers can render a
   * helpful message ("upgrade to cloud for weekly rollups") without
   * special-casing the error.
   */
  async weeklyDigest(opts: { week?: string; force?: boolean }): Promise<WeeklyDigestResult> {
    void opts;
    return {
      ok: false,
      week: 'local',
      skipped: 'local_unsupported',
      error:
        'Weekly digests run cloud-only — switch with `npx spine-mcp init --key YOUR_KEY` and try again.',
    };
  }

  async forget(id: string): Promise<boolean> {
    // Forget is forget — hard delete. The row (and its embedding) is gone.
    const res = this.db.prepare('delete from memories where id = ?').run(id);
    return res.changes > 0;
  }

  async usage(): Promise<UsageStats> {
    const count = this.liveCount();
    const status = await this.getLicenseStatus();
    const limit = status.cap;
    const pctUsed =
      limit === null ? 0 : Math.min(100, Math.round((count / Math.max(1, limit)) * 100));
    return {
      count,
      plan: status.plan,
      limit,
      pctUsed,
      nextReset: null,
    };
  }

  async hygiene(): Promise<HygieneSummary> {
    // Local mode has no clusters, no dedupe cron, no retrieval tracking.
    // Return a shape-compatible "nothing to do" summary so callers can branch
    // on the plan without crashing on missing fields.
    const status = await this.getLicenseStatus();
    return {
      plan: status.plan,
      duplicatesPending: 0,
      staleCount: 0,
      clusterCount: 0,
      largestCluster: null,
    };
  }

  close(): void {
    this.db.close();
  }
}

function safeParse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function extractSessionTag(tags: string[]): string | null {
  for (const t of tags) {
    if (t.startsWith('session:')) return t;
  }
  return null;
}
