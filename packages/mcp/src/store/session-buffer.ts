// Session buffer — local sqlite mirror of cloud capture-turn writes.
//
// Why this exists (B1, 2026-05-08): cloud-only turn capture is fine for
// recall_recent during a normal session, but if the user's machine crashes
// before the Stop hook fires, the structured digest is lost and the next
// session's recall_recent silently misses everything from the dead session.
// The buffer gives us a recoverable transcript so a SessionStart hook can
// reconstruct the missing digest.
//
// Append-only. One row per (session_id, ts) — duplicates are silently
// dropped. Cleared per-session after a successful recovery digest fires.
//
// Lives at ~/.spine/session_buffer.db. Independent from memories.db (the
// local-mode store) so cloud users still have a buffer even when their
// memories live in Supabase.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BUFFER_PATH = join(homedir(), '.spine', 'session_buffer.db');

export type BufferedTurn = {
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  filesTouched: string[] | null;
  ts: string;
};

type Row = {
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  files_touched: string | null;
  ts: string;
  flushed: number;
};

export class SessionBuffer {
  private db: Database.Database;

  constructor(dbPath: string = BUFFER_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists buffered_turns (
        session_id    text not null,
        role          text not null,
        content       text not null,
        tool_name     text,
        files_touched text,
        ts            text not null,
        flushed       integer not null default 0,
        primary key (session_id, ts, role)
      );
      create index if not exists buffered_turns_session_idx
        on buffered_turns (session_id, flushed);
      create index if not exists buffered_turns_ts_idx
        on buffered_turns (ts);
    `);
  }

  push(turn: BufferedTurn): void {
    this.db
      .prepare(
        `insert or ignore into buffered_turns
           (session_id, role, content, tool_name, files_touched, ts, flushed)
         values (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        turn.sessionId,
        turn.role,
        turn.content,
        turn.toolName ?? null,
        turn.filesTouched ? JSON.stringify(turn.filesTouched) : null,
        turn.ts,
      );
  }

  // Sessions in the buffer that still have unflushed turns. Caller uses
  // this to find candidates for crash recovery.
  unflushedSessions(): { sessionId: string; turnCount: number; firstTs: string; lastTs: string }[] {
    const rows = this.db
      .prepare(
        `select session_id,
                count(*) as turn_count,
                min(ts)  as first_ts,
                max(ts)  as last_ts
         from buffered_turns
         where flushed = 0
         group by session_id
         order by max(ts) asc`,
      )
      .all() as { session_id: string; turn_count: number; first_ts: string; last_ts: string }[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      turnCount: r.turn_count,
      firstTs: r.first_ts,
      lastTs: r.last_ts,
    }));
  }

  // Pull all unflushed turns for a session in chronological order. Used
  // by the recover command to assemble a digest payload.
  turnsForSession(sessionId: string): BufferedTurn[] {
    const rows = this.db
      .prepare(
        `select session_id, role, content, tool_name, files_touched, ts, flushed
         from buffered_turns
         where session_id = ? and flushed = 0
         order by ts asc`,
      )
      .all(sessionId) as Row[];
    return rows.map((r) => ({
      sessionId: r.session_id,
      role: r.role as 'user' | 'assistant' | 'tool',
      content: r.content,
      toolName: r.tool_name,
      filesTouched: r.files_touched ? (JSON.parse(r.files_touched) as string[]) : null,
      ts: r.ts,
    }));
  }

  // Mark every turn in a session as flushed. Caller invokes after the
  // digest write to cloud has succeeded — keeps the rows around for
  // forensics but they no longer trigger recovery.
  markFlushed(sessionId: string): number {
    const info = this.db
      .prepare(`update buffered_turns set flushed = 1 where session_id = ? and flushed = 0`)
      .run(sessionId);
    return info.changes;
  }

  // Trim older flushed rows. Default keeps 14 days of history.
  pruneOlderThan(days: number = 14): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const info = this.db
      .prepare(`delete from buffered_turns where flushed = 1 and ts < ?`)
      .run(cutoff);
    return info.changes;
  }

  close(): void {
    this.db.close();
  }
}
