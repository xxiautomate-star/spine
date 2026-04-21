import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cosine } from '../embed/index.js';
import { localEmbedder } from '../embed/local.js';
import { getLicense, type LicenseStatus } from '../license.js';
import type {
  CaptureInput,
  HygieneSummary,
  Memory,
  Store,
  TimelineOpts,
  UsageStats,
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
    const qvec = await localEmbedder.embed(query);
    const rows = this.db
      .prepare('select * from memories where deleted_at is null')
      .all() as Row[];
    const scored = rows.map((r) => ({
      row: r,
      sim: cosine(qvec, toFloat32(r.embedding)),
    }));
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit).map(({ row, sim }) => ({
      id: row.id,
      content: row.content,
      source: row.source,
      tags: safeParse(row.tags),
      type: (row.type ?? 'context') as import('./index.js').MemoryType,
      createdAt: row.created_at,
      similarity: sim,
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
