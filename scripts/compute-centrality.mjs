#!/usr/bin/env node
// Compute personalized PageRank centrality over memory_edges per user, write
// the score back to memories.centrality. Run nightly or after bulk ingest.
//
// Algorithm: power iteration on the damping-adjusted transition matrix.
//   rank_new[i] = (1-d)/N + d * sum_j(rank[j] * edge_weight[j,i] / out_weight[j])
// Default damping = 0.85, 30 iterations or until L1 delta < 1e-6.
//
// Usage:
//   node scripts/compute-centrality.mjs
//   node scripts/compute-centrality.mjs --user <uuid>
//   node scripts/compute-centrality.mjs --damping 0.85 --iterations 30

import { createClient } from '@supabase/supabase-js';

const args = parseArgs(process.argv.slice(2));
const DAMPING = Number(args.damping ?? 0.85);
const MAX_ITER = Number(args.iterations ?? 30);
const CONVERGE = 1e-6;
const SCOPED_USER = typeof args.user === 'string' ? args.user : null;

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
  if (!v) { console.error(`[centrality] Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function listUsers() {
  if (SCOPED_USER) return [SCOPED_USER];
  const { data, error } = await supabase
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .limit(100000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.user_id))];
}

async function loadGraph(userId) {
  // Pull all nodes (memory IDs) + all edges for this user.
  const [{ data: mems, error: memErr }, { data: edges, error: edgeErr }] = await Promise.all([
    supabase
      .from('memories')
      .select('id')
      .eq('user_id', userId)
      .is('deleted_at', null),
    supabase
      .from('memory_edges')
      .select('chunk_id_a, chunk_id_b, weight')
      .eq('user_id', userId),
  ]);
  if (memErr) throw new Error(`memories: ${memErr.message}`);
  if (edgeErr) throw new Error(`edges: ${edgeErr.message}`);

  const nodes = (mems ?? []).map((r) => r.id);
  const indexOf = new Map(nodes.map((id, i) => [id, i]));

  // Bidirectional edges (entity links are undirected). Sum weights.
  const outWeight = new Float64Array(nodes.length);
  const adj = Array.from({ length: nodes.length }, () => []); // [{to, w}, ...]

  for (const e of edges ?? []) {
    const a = indexOf.get(e.chunk_id_a);
    const b = indexOf.get(e.chunk_id_b);
    if (a === undefined || b === undefined) continue;
    const w = Number(e.weight ?? 1);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
    outWeight[a] += w;
    outWeight[b] += w;
  }

  return { nodes, adj, outWeight };
}

function pagerank({ nodes, adj, outWeight }) {
  const n = nodes.length;
  if (n === 0) return [];

  const rank = new Float64Array(n).fill(1 / n);
  const teleport = (1 - DAMPING) / n;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const next = new Float64Array(n).fill(teleport);
    for (let i = 0; i < n; i++) {
      if (outWeight[i] === 0) {
        // Dangling node — redistribute uniformly.
        const share = (DAMPING * rank[i]) / n;
        for (let j = 0; j < n; j++) next[j] += share;
      } else {
        for (const { to, w } of adj[i]) {
          next[to] += DAMPING * rank[i] * (w / outWeight[i]);
        }
      }
    }

    let delta = 0;
    for (let i = 0; i < n; i++) delta += Math.abs(next[i] - rank[i]);
    for (let i = 0; i < n; i++) rank[i] = next[i];

    if (delta < CONVERGE) {
      console.log(`[centrality]   converged at iter ${iter + 1} (Δ=${delta.toExponential(2)})`);
      break;
    }
    if (iter === MAX_ITER - 1) {
      console.log(`[centrality]   max iter ${MAX_ITER} hit (Δ=${delta.toExponential(2)})`);
    }
  }

  return rank;
}

async function writeBack(userId, nodes, rank) {
  // Batch updates in chunks of 100 to avoid giant multi-row updates.
  const CHUNK = 100;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const updates = nodes.slice(i, i + CHUNK).map((id, j) => ({
      id,
      centrality: rank[i + j],
    }));
    // Supabase doesn't support bulk update-on-id across rows without upsert.
    // Use upsert on the primary key — only centrality is supplied, the row
    // must already exist so this is effectively "update where id in (...)".
    // To avoid replacing NOT NULL columns with nulls, issue individual
    // updates; this is a nightly batch so latency is fine.
    await Promise.all(
      updates.map((u) =>
        supabase
          .from('memories')
          .update({ centrality: u.centrality })
          .eq('id', u.id)
          .eq('user_id', userId)
      )
    );
  }
}

async function main() {
  const users = await listUsers();
  console.log(`[centrality] users to process: ${users.length}`);

  for (const userId of users) {
    const t0 = Date.now();
    const graph = await loadGraph(userId);
    if (graph.nodes.length === 0) {
      console.log(`[centrality] ${userId.slice(0, 8)}… skipped (no memories)`);
      continue;
    }
    const rank = pagerank(graph);
    await writeBack(userId, graph.nodes, rank);
    console.log(
      `[centrality] ${userId.slice(0, 8)}… n=${graph.nodes.length} ` +
        `edges=${graph.adj.reduce((s, a) => s + a.length, 0) / 2} ` +
        `in ${((Date.now() - t0) / 1000).toFixed(1)}s`
    );
  }
  console.log('[centrality] done.');
}

main().catch((err) => {
  console.error('[centrality] FAILED:', err);
  process.exit(1);
});
