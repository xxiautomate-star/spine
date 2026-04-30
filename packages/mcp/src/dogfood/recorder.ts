// Dogfood telemetry recorder. Wraps a SQLite database at ~/.spine/dogfood.db
// and exposes a `record()` callback that the MCP server's onToolCall hook
// can invoke. Schema designed for the diary endpoint (Gate A acceptance):
//   - last 7 days: total captures, capture/day rate, signal-tier
//     distribution, recall hit rate, false-positive rate
//
// We DON'T touch the user's primary store. The dogfood db is purely an
// observability sidecar — deleting it leaves Spine working unchanged.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolCallTelemetry } from '../server.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                    -- epoch ms
  name TEXT NOT NULL,                     -- spine_remember | spine_recall | ...
  outcome TEXT NOT NULL,                  -- 'ok' | 'error'
  latency_ms INTEGER NOT NULL,
  args_json TEXT NOT NULL,                -- input args (verbatim)
  result_preview TEXT,                    -- first 4KB of the result text
  error_message TEXT,
  hit_count INTEGER,                      -- recall hits (parsed lazily, see below)
  signal_tier TEXT,                       -- capture-only: high|standard|low
  source TEXT                             -- claude|chatgpt|cursor|other (best-effort tag)
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_ts ON tool_calls(ts);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(name);

CREATE TABLE IF NOT EXISTS injection_traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT,                        -- best-effort, may be null
  memory_id TEXT NOT NULL,                -- the memory id surfaced to the LLM
  was_referenced INTEGER NOT NULL DEFAULT 0  -- 1 if the LLM later cited it in same session
);

CREATE INDEX IF NOT EXISTS idx_injection_session ON injection_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_injection_ts ON injection_traces(ts);
`;

// Tool names this module knows how to interpret. New tools added to
// tools.ts don't need updates here — they'll just record as opaque rows.
const RECALL_TOOLS = new Set(['spine_recall', 'spine_search', 'search_memory', 'spine_get_context']);
const CAPTURE_TOOLS = new Set(['spine_remember', 'add_memory', 'add_team_memory', 'spine_capture_turn']);

export class DogfoodRecorder {
  private db: Database.Database;
  private insertCall: Database.Statement;
  private insertInjection: Database.Statement;

  constructor(public readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    // WAL keeps concurrent readers (the diary endpoint) from blocking
    // writers (the MCP server) and vice versa.
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);

    this.insertCall = this.db.prepare(
      `INSERT INTO tool_calls
        (ts, name, outcome, latency_ms, args_json, result_preview, error_message, hit_count, signal_tier, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this.insertInjection = this.db.prepare(
      `INSERT INTO injection_traces (ts, session_id, memory_id, was_referenced) VALUES (?, ?, ?, 0)`
    );
  }

  record(event: ToolCallTelemetry): void {
    let hitCount: number | null = null;
    let signalTier: string | null = null;
    const source = pickSource(event.args);

    if (RECALL_TOOLS.has(event.name) && event.outcome === 'ok' && event.resultPreview) {
      hitCount = countRecallHits(event.resultPreview);
      // Best-effort: if the recall returned memory ids, log them as
      // injection traces so the diary can compute false-positive rate.
      const ids = extractMemoryIds(event.resultPreview);
      const sessionId = pickSessionId(event.args);
      for (const id of ids) {
        this.insertInjection.run(event.startedAt, sessionId, id);
      }
    }

    if (CAPTURE_TOOLS.has(event.name) && event.outcome === 'ok' && event.resultPreview) {
      // The capture tool's result text usually carries the assigned signal
      // tier on a line like "tier=standard". We surface it for the diary.
      signalTier = parseSignalTier(event.resultPreview);
    }

    this.insertCall.run(
      event.startedAt,
      event.name,
      event.outcome,
      event.latencyMs,
      JSON.stringify(event.args),
      event.resultPreview,
      event.errorMessage,
      hitCount,
      signalTier,
      source
    );
  }

  /**
   * Compute the diary metrics for the trailing N days. Pure SQL — no
   * cleanup, no aggregation outside SQLite. Same shape the
   * `/api/dogfood/diary` endpoint surfaces.
   */
  diary(days = 7) {
    const since = Date.now() - days * 86_400_000;
    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) FILTER (WHERE name IN ${sqlArray(CAPTURE_TOOLS)}) AS captures,
           COUNT(*) FILTER (WHERE name IN ${sqlArray(RECALL_TOOLS)}) AS recalls,
           COUNT(*) FILTER (WHERE name IN ${sqlArray(RECALL_TOOLS)} AND outcome = 'ok' AND IFNULL(hit_count, 0) > 0) AS recalls_with_hit
         FROM tool_calls
         WHERE ts >= ?`
      )
      .get(since) as { captures: number; recalls: number; recalls_with_hit: number };

    const tierDist = this.db
      .prepare(
        `SELECT signal_tier AS tier, COUNT(*) AS n
         FROM tool_calls
         WHERE ts >= ? AND name IN ${sqlArray(CAPTURE_TOOLS)} AND signal_tier IS NOT NULL
         GROUP BY signal_tier`
      )
      .all(since) as Array<{ tier: string; n: number }>;

    const sourceDist = this.db
      .prepare(
        `SELECT source, COUNT(*) AS n
         FROM tool_calls
         WHERE ts >= ? AND source IS NOT NULL
         GROUP BY source`
      )
      .all(since) as Array<{ source: string; n: number }>;

    const injectionTotals = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE was_referenced = 1) AS referenced
         FROM injection_traces
         WHERE ts >= ?`
      )
      .get(since) as { total: number; referenced: number };

    const recallHitRate = totals.recalls > 0 ? totals.recalls_with_hit / totals.recalls : null;
    const falsePositiveRate =
      injectionTotals.total > 0
        ? 1 - injectionTotals.referenced / injectionTotals.total
        : null;

    return {
      windowDays: days,
      windowStart: new Date(since).toISOString(),
      windowEnd: new Date().toISOString(),
      totals: {
        captures: totals.captures,
        recalls: totals.recalls,
        capturesPerDay: totals.captures / days,
        recallsPerDay: totals.recalls / days,
      },
      recall: {
        hitRate: recallHitRate,
        recallsWithHit: totals.recalls_with_hit,
      },
      injection: {
        memoriesInjected: injectionTotals.total,
        memoriesReferenced: injectionTotals.referenced,
        // Conservative metric: a memory is a "false positive" if it was
        // injected but the LLM never referenced it back in the same
        // session. The reference-tracking is fed by Spine's own
        // /api/recall/feedback endpoint (planned). Until that lands,
        // this metric will read as 1.0 — flagged in the docs.
        falsePositiveRate,
      },
      signalTierDistribution: Object.fromEntries(
        tierDist.map((r) => [r.tier, r.n])
      ),
      sourceDistribution: Object.fromEntries(
        sourceDist.map((r) => [r.source, r.n])
      ),
    };
  }

  close(): void {
    this.db.close();
  }
}

function sqlArray(set: Set<string>): string {
  return '(' + Array.from(set).map((s) => `'${s.replace(/'/g, "''")}'`).join(',') + ')';
}

function countRecallHits(preview: string): number {
  // The recall tool result is human-readable text. It surfaces hits as
  // either "[1] ..." prefixed lines, or a YAML list. We grep both.
  const hashed = (preview.match(/^\[\d+\]/gm) ?? []).length;
  const dashed = (preview.match(/^- /gm) ?? []).length;
  return Math.max(hashed, dashed);
}

function extractMemoryIds(preview: string): string[] {
  // Memory ids are UUIDs; recall results render them next to each hit.
  // We cap at 50 so a wide recall doesn't bloat the trace table.
  const ids = preview.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  return Array.from(new Set(ids)).slice(0, 50);
}

function parseSignalTier(preview: string): string | null {
  const m = preview.match(/tier[=:]\s*(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

function pickSource(args: Record<string, unknown>): string {
  // Best-effort tag. Preference order: explicit source > tool_name hint >
  // unknown. The MCP server doesn't know which AI client is calling it,
  // but Claude Code passes a UA-like string in some hooks.
  const explicit = typeof args.source === 'string' ? args.source : null;
  if (explicit) return explicit.toLowerCase();
  const toolName = typeof args.tool_name === 'string' ? args.tool_name : null;
  if (toolName) {
    if (toolName.toLowerCase().includes('claude')) return 'claude';
    if (toolName.toLowerCase().includes('cursor')) return 'cursor';
  }
  return 'unknown';
}

function pickSessionId(args: Record<string, unknown>): string | null {
  return typeof args.session_id === 'string' ? args.session_id : null;
}
