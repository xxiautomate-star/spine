// Reader for the dogfood SQLite produced by `spine-mcp dogfood`. Pure
// read-only — opens the file, runs aggregation queries, returns the
// shape consumed by /api/dogfood/diary.
//
// Why this lives in `lib/` rather than importing from @spine/mcp:
//   - better-sqlite3 is a native module; keeping the import local to the
//     dashboard avoids a cross-workspace dynamic-import dance under
//     Next.js bundling
//   - The MCP package writes the schema; this file reads it. Tying them
//     together via a shared schema string keeps both honest.
//
// IMPORTANT: keep the SQL in sync with packages/mcp/src/dogfood/recorder.ts.
// The schema is documented at the top of that file.

import Database from 'better-sqlite3';

// Tool-name buckets — must match the recorder's writer-side classification.
const RECALL_TOOLS = [
  'spine_recall',
  'spine_search',
  'search_memory',
  'spine_get_context',
] as const;
const CAPTURE_TOOLS = [
  'spine_remember',
  'add_memory',
  'add_team_memory',
  'spine_capture_turn',
] as const;

function sqlList(arr: readonly string[]): string {
  return '(' + arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',') + ')';
}

export type DogfoodDiary = {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  totals: {
    captures: number;
    recalls: number;
    capturesPerDay: number;
    recallsPerDay: number;
  };
  recall: {
    hitRate: number | null;
    recallsWithHit: number;
  };
  injection: {
    memoriesInjected: number;
    memoriesReferenced: number;
    falsePositiveRate: number | null;
  };
  signalTierDistribution: Record<string, number>;
  sourceDistribution: Record<string, number>;
};

export function readDogfoodDiary(dbPath: string, days: number): DogfoodDiary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const since = Date.now() - days * 86_400_000;

    const totals = db
      .prepare(
        `SELECT
           COUNT(*) FILTER (WHERE name IN ${sqlList(CAPTURE_TOOLS)}) AS captures,
           COUNT(*) FILTER (WHERE name IN ${sqlList(RECALL_TOOLS)}) AS recalls,
           COUNT(*) FILTER (WHERE name IN ${sqlList(RECALL_TOOLS)} AND outcome = 'ok' AND IFNULL(hit_count, 0) > 0) AS recalls_with_hit
         FROM tool_calls
         WHERE ts >= ?`
      )
      .get(since) as { captures: number; recalls: number; recalls_with_hit: number };

    const tierDist = db
      .prepare(
        `SELECT signal_tier AS tier, COUNT(*) AS n
         FROM tool_calls
         WHERE ts >= ? AND name IN ${sqlList(CAPTURE_TOOLS)} AND signal_tier IS NOT NULL
         GROUP BY signal_tier`
      )
      .all(since) as Array<{ tier: string; n: number }>;

    const sourceDist = db
      .prepare(
        `SELECT source, COUNT(*) AS n
         FROM tool_calls
         WHERE ts >= ? AND source IS NOT NULL
         GROUP BY source`
      )
      .all(since) as Array<{ source: string; n: number }>;

    const injectionTotals = db
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
      injectionTotals.total > 0 ? 1 - injectionTotals.referenced / injectionTotals.total : null;

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
        falsePositiveRate,
      },
      signalTierDistribution: Object.fromEntries(tierDist.map((r) => [r.tier, r.n])),
      sourceDistribution: Object.fromEntries(sourceDist.map((r) => [r.source, r.n])),
    };
  } finally {
    db.close();
  }
}
