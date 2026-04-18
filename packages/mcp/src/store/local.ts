import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cosine } from '../embed/index.js';
import { localEmbedder } from '../embed/local.js';
import type { CaptureInput, Memory, Store, TimelineOpts } from './index.js';

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string;
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

export class LocalStore implements Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists memories (
        id          text primary key,
        content     text not null,
        source      text,
        tags        text not null default '[]',
        embedding   blob not null,
        created_at  text not null,
        deleted_at  text
      );
      create index if not exists memories_created_idx
        on memories (created_at desc);
    `);
  }

  async capture(input: CaptureInput): Promise<string> {
    const vec = await localEmbedder.embed(input.content);
    const id = randomUUID();
    this.db
      .prepare(
        'insert into memories (id, content, source, tags, embedding, created_at) values (?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        input.content,
        input.source ?? null,
        JSON.stringify(input.tags ?? []),
        fromFloat32(vec),
        new Date().toISOString()
      );
    return id;
  }

  async captureBulk(inputs: CaptureInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const vecs = await localEmbedder.embedBatch(inputs.map((i) => i.content));
    const ids: string[] = [];
    const stmt = this.db.prepare(
      'insert into memories (id, content, source, tags, embedding, created_at) values (?, ?, ?, ?, ?, ?)'
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
    sql += ' order by created_at desc limit ?';
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      tags: safeParse(r.tags),
      createdAt: r.created_at,
    }));
  }

  async forget(id: string): Promise<boolean> {
    // Forget is forget — hard delete. The row (and its embedding) is gone.
    const res = this.db.prepare('delete from memories where id = ?').run(id);
    return res.changes > 0;
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
