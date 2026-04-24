#!/usr/bin/env node
// Needle-in-haystack benchmark. Inserts N uniquely-tagged memories, runs
// M queries per needle, measures:
//   - retrieval latency (p50/p95/p99/avg/max)
//   - needle-in-top-K accuracy (did the query surface the right memory?)
// Writes a row to saas_spine_bench_runs and one per-needle row to
// saas_spine_bench_needles.
//
// Usage:
//   node scripts/scale-bench.mjs --needles 20 --queries 100 --top-k 5
//
// The bench runs against whatever is currently in the memories table under
// SPINE_BENCH_USER_ID, so call this AFTER scale-seed.mjs.

import { createClient } from '@supabase/supabase-js';
import { generateNeedle, needleQuery, makeToken } from './scale-corpus.mjs';

const args = parseArgs(process.argv.slice(2));
const NEEDLE_COUNT = Number(args.needles ?? 20);
const QUERY_COUNT = Number(args.queries ?? 100);
const TOP_K = Number(args['top-k'] ?? 5);
const NOTES = args.notes ?? null;

const EMBED_MODEL = 'text-embedding-3-small';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function must(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[scale-bench] Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_KEY = must('OPENAI_API_KEY');
const BENCH_USER = must('SPINE_BENCH_USER_ID');
const GIT_SHA = process.env.GIT_SHA ?? 'unknown';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function currentScale() {
  const { count } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', BENCH_USER)
    .is('deleted_at', null);
  return count ?? 0;
}

async function insertNeedle(token) {
  const { content, source, tags } = generateNeedle(token);
  const vec = await embed(content);
  const { data, error } = await supabase
    .from('memories')
    .insert({
      user_id: BENCH_USER,
      content,
      source,
      tags,
      embedding: vec,
      is_bench: true,
    })
    .select('id')
    .single();
  if (error) throw new Error(`needle insert: ${error.message}`);
  return data.id;
}

async function runQuery(query, needleId) {
  const vec = await embed(query);
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('spine_match_memories', {
    p_user: BENCH_USER,
    p_query_embedding: vec,
    p_limit: TOP_K,
  });
  const latencyMs = Date.now() - t0;
  if (error) throw new Error(`rpc: ${error.message}`);

  const rows = (data ?? []);
  const rank = rows.findIndex((r) => r.id === needleId);
  const found = rank >= 0;
  const similarity = found ? rows[rank].similarity : null;

  return { latencyMs, found, rank: found ? rank + 1 : null, similarity };
}

async function main() {
  console.log(`[scale-bench] needles=${NEEDLE_COUNT} queries=${QUERY_COUNT} top_k=${TOP_K}`);

  // Snapshot scale BEFORE inserting needles so the published number is
  // "out of N, we found our Ks". Needles get added to that N.
  const baseScale = await currentScale();
  console.log(`[scale-bench] Baseline scale: ${baseScale.toLocaleString()} memories`);

  // Insert N needles with unique tokens.
  const needles = [];
  for (let i = 0; i < NEEDLE_COUNT; i++) {
    const token = makeToken('round17', Date.now() + i);
    const id = await insertNeedle(token);
    needles.push({ token, id });
  }
  const scale = baseScale + needles.length;
  console.log(`[scale-bench] Inserted ${needles.length} needles. Effective scale: ${scale.toLocaleString()}`);

  // For each needle, fire QUERY_COUNT/NEEDLE_COUNT queries (at least 1 each).
  const queriesPerNeedle = Math.max(1, Math.floor(QUERY_COUNT / NEEDLE_COUNT));
  const allLatencies = [];
  const results = [];
  let found = 0;
  const totalQueries = queriesPerNeedle * needles.length;

  for (const needle of needles) {
    for (let q = 0; q < queriesPerNeedle; q++) {
      const query = needleQuery(needle.token);
      try {
        const r = await runQuery(query, needle.id);
        allLatencies.push(r.latencyMs);
        if (r.found) found++;
        results.push({ ...r, token: needle.token, query, memoryId: needle.id });
      } catch (e) {
        console.warn('[scale-bench] query failed:', e.message);
      }
    }
  }

  const sorted = [...allLatencies].sort((a, b) => a - b);
  const avg = sorted.length === 0 ? 0 : sorted.reduce((s, n) => s + n, 0) / sorted.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1] ?? 0;
  const accuracy = totalQueries === 0 ? 0 : found / totalQueries;

  console.log(
    `[scale-bench] latency p50=${p50}ms p95=${p95}ms p99=${p99}ms max=${max}ms avg=${avg.toFixed(1)}ms`
  );
  console.log(
    `[scale-bench] needles found ${found}/${totalQueries} (${(accuracy * 100).toFixed(1)}%)`
  );

  const { data: run, error: runErr } = await supabase
    .from('saas_spine_bench_runs')
    .insert({
      scale,
      needle_count: needles.length,
      query_count: totalQueries,
      top_k: TOP_K,
      needles_found: found,
      recall_accuracy: accuracy,
      p50_latency_ms: p50,
      p95_latency_ms: p95,
      p99_latency_ms: p99,
      avg_latency_ms: Math.round(avg),
      max_latency_ms: max,
      embed_model: EMBED_MODEL,
      git_sha: GIT_SHA,
      notes: NOTES,
    })
    .select('id')
    .single();

  if (runErr) {
    console.error('[scale-bench] Could not save run:', runErr.message);
    process.exit(1);
  }

  const needleRows = results.map((r) => ({
    run_id: run.id,
    memory_id: r.memoryId,
    token: r.token,
    query: r.query,
    rank: r.rank,
    similarity: r.similarity,
    found: r.found,
  }));

  const { error: needleErr } = await supabase.from('saas_spine_bench_needles').insert(needleRows);
  if (needleErr) {
    console.warn('[scale-bench] Could not save needle rows:', needleErr.message);
  }

  console.log(`[scale-bench] Saved run ${run.id}`);
}

main().catch((err) => {
  console.error('[scale-bench] FAILED:', err);
  process.exit(1);
});
