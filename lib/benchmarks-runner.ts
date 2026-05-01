// Gate D — benchmark runner. Pure logic; no runtime entrypoint.
// Called from app/api/cron/benchmarks (the public Spine deploy hits
// itself on a weekly schedule). Lives in lib/ so Next can bundle it.
//
// Loads the recall-quality fixture corpus (200 memories, 30 queries),
// runs each query against /api/recall, computes precision@5,
// recall@10, false-positive rate, and latency percentiles. Writes one
// row to benchmark_runs.

import { getSupabase } from './supabase';
import {
  MEMORIES,
  QUERIES,
  THEME_TAG_PREFIX,
  type Theme,
} from '../tests/fixtures/recall-quality-data';

export type BenchmarkResult = {
  precisionAt5: number;
  recallAt10: number;
  falsePositiveRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  corpusSize: number;
  queryCount: number;
  totalMemoriesCount: number | null;
  totalUsersCount: number | null;
};

// SHOULD-MISS queries (sampled from the Gate A real-conversation
// harness). A retriever that surfaces themed memories on these is
// returning false positives.
const FALSE_POSITIVE_QUERIES = [
  'best chocolate cake recipe',
  'how to fix a leaky kitchen tap',
  'what is the chord progression for canon in D',
  'how do I train for a marathon I have never seen',
  'recommend a movie about chess',
];

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function recall(
  baseUrl: string,
  apiKey: string,
  query: string,
  limit: number
): Promise<{ hits: Array<{ id: string; tags: string[] }>; latencyMs: number }> {
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/api/recall`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, limit }),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    throw new Error(`recall ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { memories?: Array<{ id: string; tags: string[] }> };
  return { hits: body.memories ?? [], latencyMs };
}

export async function runBenchmark(
  baseUrl: string,
  apiKey: string
): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  // ── Precision @ 5 ───────────────────────────────────────────────────
  let totalP5 = 0;
  for (const { query, theme } of QUERIES) {
    const { hits, latencyMs } = await recall(baseUrl, apiKey, query, 5);
    latencies.push(latencyMs);
    const tag = `${THEME_TAG_PREFIX}${theme}`;
    const themed = hits.slice(0, 5).filter((m) => m.tags.includes(tag)).length;
    const p5 = hits.length === 0 ? 0 : themed / Math.min(5, hits.length);
    totalP5 += p5;
  }
  const precisionAt5 = totalP5 / QUERIES.length;

  // ── Recall @ 10 ─────────────────────────────────────────────────────
  const found = new Map<Theme, Set<string>>();
  for (const t of Object.keys(MEMORIES) as Theme[]) found.set(t, new Set());
  for (const { query, theme } of QUERIES) {
    const { hits, latencyMs } = await recall(baseUrl, apiKey, query, 10);
    latencies.push(latencyMs);
    const tag = `${THEME_TAG_PREFIX}${theme}`;
    const set = found.get(theme)!;
    for (const h of hits) if (h.tags.includes(tag)) set.add(h.id);
  }
  let totalRecall = 0;
  for (const [theme, set] of found.entries()) {
    totalRecall += set.size / MEMORIES[theme].length;
  }
  const recallAt10 = totalRecall / found.size;

  // ── False-positive rate ─────────────────────────────────────────────
  let signalSlots = 0;
  let totalSlots = 0;
  for (const query of FALSE_POSITIVE_QUERIES) {
    const { hits, latencyMs } = await recall(baseUrl, apiKey, query, 5);
    latencies.push(latencyMs);
    const top5 = hits.slice(0, 5);
    totalSlots += top5.length;
    signalSlots += top5.filter((m) =>
      m.tags.some((t) => t.startsWith(THEME_TAG_PREFIX))
    ).length;
  }
  const falsePositiveRate = totalSlots === 0 ? 0 : signalSlots / totalSlots;

  // ── Anonymous totals — best-effort, swallowed on error ──────────────
  let totalMemoriesCount: number | null = null;
  let totalUsersCount: number | null = null;
  const sb = getSupabase();
  if (sb) {
    try {
      const memQ = await sb
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null);
      totalMemoriesCount = memQ.count ?? null;
    } catch {
      /* best-effort */
    }
    try {
      const userQ = await sb.rpc('spine_distinct_user_count');
      if (typeof userQ.data === 'number') totalUsersCount = userQ.data;
    } catch {
      /* the RPC may not exist on every project — ignore */
    }
  }

  const corpusSize = Object.values(MEMORIES).reduce((s, a) => s + a.length, 0);

  return {
    precisionAt5,
    recallAt10,
    falsePositiveRate,
    medianLatencyMs: Math.round(median(latencies)),
    p95LatencyMs: Math.round(percentile(latencies, 95)),
    corpusSize,
    queryCount: QUERIES.length,
    totalMemoriesCount,
    totalUsersCount,
  };
}

export async function persistRun(
  result: BenchmarkResult,
  notes = 'cron'
): Promise<{ id: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('benchmark_runs')
    .insert({
      precision_at_5: result.precisionAt5,
      recall_at_10: result.recallAt10,
      false_positive_rate: result.falsePositiveRate,
      median_latency_ms: result.medianLatencyMs,
      p95_latency_ms: result.p95LatencyMs,
      corpus_size: result.corpusSize,
      query_count: result.queryCount,
      harness_name: 'recall-quality',
      notes,
      total_memories_count: result.totalMemoriesCount,
      total_users_count: result.totalUsersCount,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[benchmarks-runner] insert failed:', error.message);
    return null;
  }
  return { id: data.id as string };
}
