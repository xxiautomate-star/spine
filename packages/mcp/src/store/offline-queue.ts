import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CaptureInput } from './index.js';

type QueueRow = { id: string; payload: string; created_at: string };

export class OfflineQueue {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists queue (
        id         text primary key,
        payload    text not null,
        created_at text not null
      );
    `);
  }

  push(input: CaptureInput): string {
    const id = randomUUID();
    this.db
      .prepare('insert into queue (id, payload, created_at) values (?, ?, ?)')
      .run(id, JSON.stringify(input), new Date().toISOString());
    return id;
  }

  drain(): CaptureInput[] {
    const rows = this.db
      .prepare('select * from queue order by created_at asc')
      .all() as QueueRow[];
    return rows.map((r) => JSON.parse(r.payload) as CaptureInput);
  }

  clear(): void {
    this.db.prepare('delete from queue').run();
  }

  size(): number {
    const row = this.db
      .prepare('select count(*) as c from queue')
      .get() as { c: number };
    return row.c;
  }

  close(): void {
    this.db.close();
  }
}
