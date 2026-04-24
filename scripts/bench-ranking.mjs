#!/usr/bin/env node
// Head-to-head ranking quality bench: rerank-v2 vs vector-only baseline.
//
// For each needle inserted, fire the same query through:
//   A. vector-only pgvector (spine_match_memories)
//   B. rerank-v2: pgvector + BM25 + recency + centrality fused with learned
//      weights, then cross-encoder rerank of top-20.
//
// Compute MRR@5 (simplified nDCG@5 for single-needle) and the lift of B over
// A. Acceptance: lift >= +12% on the running corpus. Also record which
// signal dominated each v2 decision so we can see what's pulling weight.
//
// Output goes to saas_spine_bench_runs with notes='ranking head-to-head'.
//
// Usage (after seeding + v3 migration applied):
//   node scripts/bench-ranking.mjs --needles 30 --queries 30

import { createClient } from '@supabase/supabase-js';
import { generateNeedle, needleQuery, makeToken } from './scale-corpus.mjs';

const args = parseArgs(process.argv.slice(2));
const NEEDLES = Number(args.needles ?? 30);
const QUERIES = Number(args.queries ?? 30);
const TOP_K = Number(args['top-k'] ?? 5);
const POOL_K = Number(args['pool-k'] ?? 20);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function must(name) {
  const v = process.env[name];
  if (!v) { console.error(`[rank-bench] Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_KEY = must('OPENAI_API_KEY');
const BENCH_USER = must('SPINE_BENCH_USER_ID');
const EMBED_MODEL = 'text-embedding-3-small';
const GIT_SHA = process.env.GIT_SHA ?? 'unknown';

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function embed(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return data.data[0].embedding;
}

async function insertNeedle(token) {
  const { content, source, tags } = generateNeedle(token);
  const vec = await embed(content);
  const { data, error } = await sb
    .from('memories')
    .insert({ user_id: BENCH_USER, content, source, tags, embedding: vec, is_bench: true })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function loadWeights() {
  const { data } = await sb
    .from('spine_rerank_weights')
    .select('bm25_w, vec_w, recency_w, centrality_w, bias, model_version, training_n')
    .or(`user_id.eq.${BENCH_USER},user_id.is.null`)
    .eq('is_active', true)
    .order('user_id', { ascending: false, nullsFirst: false })
    .limit(1);
  return (data ?? [])[0] ?? { bm25_w: 0.25, vec_w: 0.55, recency_w: 0.1, centrality_w: 0.1, bias: 0, model_version: 'default-v1', training_n: 0 };
}

function normaliseMaxDiv(values) {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => (v > 0 ? v / max : 0));
}

async function vectorOnlyRank(query, needleId) {
  const vec = await embed(query);
  const t0 = Date.now();
  const { data, error } = await sb.rpc('spine_match_memories', {
    p_user: BENCH_USER,
    p_query_embedding: vec,
    p_limit: TOP_K,
  });
  const latency = Date.now() - t0;
  if (error) throw new Error(error.message);
  const rank = (data ?? []).findIndex((r) => r.id === needleId);
  return { rank: rank >= 0 ? rank + 1 : null, latency };
}

async function v2Rank(query, needleId, weights) {
  const vec = await embed(query);
  const t0 = Date.now();
  const { data, error } = await sb.rpc('spine_hybrid_candidates_v3', {
    p_user: BENCH_USER,
    p_query: query,
    p_query_embedding: vec,
    p_limit: POOL_K,
  });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return { rank: null, dominant: null, latency: Date.now() - t0 };

  const now = Date.now();
  const tau = (90 * 86400 * 1000) / Math.LN2;
  const bm25N = normaliseMaxDiv(rows.map((r) => Number(r.bm25_rank)));
  const vecN = rows.map((r) => Math.max(0, Math.min(1, Number(r.vec_similarity))));
  const recN = rows.map((r) => {
    const age = now - new Date(r.created_at).getTime();
    return Math.exp(-age / tau);
  });
  const cenN = normaliseMaxDiv(rows.map((r) => Math.max(0, Number(r.centrality ?? 0))));

  const scored = rows.map((r, i) => {
    const c = {
      bm25: weights.bm25_w * bm25N[i],
      vec: weights.vec_w * vecN[i],
      recency: weights.recency_w * recN[i],
      centrality: weights.centrality_w * cenN[i],
    };
    const final = c.bm25 + c.vec + c.recency + c.centrality + (weights.bias ?? 0);
    let dom = 'vec';
    let best = -Infinity;
    for (const k of Object.keys(c)) {
      if (c[k] > best) { best = c[k]; dom = k; }
    }
    return { id: r.id, final, dom };
  });
  scored.sort((a, b) => b.final - a.final);
  const top = scored.slice(0, TOP_K);
  const rank = top.findIndex((x) => x.id === needleId);
  const dominantOfHit = rank >= 0 ? top[rank].dom : null;
  return { rank: rank >= 0 ? rank + 1 : null, dominant: dominantOfHit, latency: Date.now() - t0 };
}

function mrr(ranks) {
  const vals = ranks.map((r) => (r && r <= TOP_K ? 1 / r : 0));
  return vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
}

async function main() {
  console.log(`[rank-bench] needles=${NEEDLES} queries=${QUERIES} top_k=${TOP_K} pool_k=${POOL_K}`);
  const weights = await loadWeights();
  console.log('[rank-bench] weights:', weights);

  // Scale at bench time
  const { count } = await sb
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', BENCH_USER)
    .is('deleted_at', null);
  const baseScale = count ?? 0;

  // Insert needles
  const needles = [];
  for (let i = 0; i < NEEDLES; i++) {
    const token = makeToken('r18rank', Date.now() + i);
    const id = await insertNeedle(token);
    needles.push({ token, id });
  }
  const scale = baseScale + needles.length;

  const vectorRanks = [];
  const v2Ranks = [];
  const vectorLatencies = [];
  const v2Latencies = [];
  const dominanceCount = { bm25: 0, vec: 0, recency: 0, centrality: 0 };

  const perNeedle = Math.max(1, Math.floor(QUERIES / NEEDLES));
  let total = 0;
  for (const n of needles) {
    for (let q = 0; q < perNeedle; q++) {
      const query = needleQuery(n.token);
      const a = await vectorOnlyRank(query, n.id);
      const b = await v2Rank(query, n.id, weights);
      vectorRanks.push(a.rank);
      v2Ranks.push(b.rank);
      vectorLatencies.push(a.latency);
      v2Latencies.push(b.latency);
      if (b.dominant) dominanceCount[b.dominant] = (dominanceCount[b.dominant] ?? 0) + 1;
      total++;
    }
  }

  const mrrVector = mrr(vectorRanks);
  const mrrV2 = mrr(v2Ranks);
  const lift = mrrVector > 0 ? ((mrrV2 - mrrVector) / mrrVector) * 100 : null;

  console.log(`[rank-bench] scale=${scale.toLocaleString()} queries=${total}`);
  console.log(`[rank-bench] MRR@${TOP_K}: vector-only=${mrrVector.toFixed(4)} v2=${mrrV2.toFixed(4)}`);
  console.log(`[rank-bench] Lift: ${lift === null ? 'n/a' : lift.toFixed(1) + '%'} (target ≥ +12%)`);
  console.log(`[rank-bench] Signal dominance:`, dominanceCount);

  // Percentiles for v2
  const sorted = [...v2Latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const avg = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);

  const needleFoundV2 = v2Ranks.filter((r) => r !== null && r <= TOP_K).length;
  const accuracy = total === 0 ? 0 : needleFoundV2 / total;

  const notes = `ranking head-to-head · weights=${weights.model_version} · lift=${lift === null ? 'n/a' : lift.toFixed(1) + '%'} · dom=${JSON.stringify(dominanceCount)}`;

  const { error } = await sb.from('saas_spine_bench_runs').insert({
    scale,
    needle_count: needles.length,
    query_count: total,
    top_k: TOP_K,
    needles_found: needleFoundV2,
    recall_accuracy: accuracy,
    p50_latency_ms: p50,
    p95_latency_ms: p95,
    p99_latency_ms: p99,
    avg_latency_ms: Math.round(avg),
    max_latency_ms: max,
    embed_model: EMBED_MODEL,
    git_sha: GIT_SHA,
    notes,
  });
  if (error) {
    console.error('[rank-bench] could not persist run:', error.message);
    process.exit(1);
  }
  console.log('[rank-bench] saved run');

  if (lift !== null && lift < 12) {
    console.log(`\n[rank-bench] WARNING: lift ${lift.toFixed(1)}% below +12% target.`);
    console.log('[rank-bench] Retrain weights with scripts/train-rerank-weights.mjs and retry.');
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[rank-bench] FAILED:', err);
  process.exit(1);
});
