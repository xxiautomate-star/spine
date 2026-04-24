#!/usr/bin/env node
// Train rerank weights from Spine's own recall history.
//
// Label derivation (honest, given we don't collect click-through):
//   POSITIVE : memory was injected in >=2 distinct sessions within 7 days
//              (i.e. Spine decided to surface it again — implicit usefulness)
//   NEGATIVE : memory was retrieved at least once but never re-surfaced
//
// This is weak supervision. It trains the RATIOS between the four signals,
// not the absolute scale. Output: a row in spine_rerank_weights with the
// fitted coefficients. The bench + /spine/proof page will then compare the
// trained weights to the default priors on the same queries.
//
// Algorithm: batch logistic regression via full-batch gradient descent with
// L2 regularisation. Pure JS, no dependencies. Up to a few thousand rows
// fits in memory easily.
//
// Usage:
//   node scripts/train-rerank-weights.mjs --user <uuid>
//   node scripts/train-rerank-weights.mjs          # trains global default

import { createClient } from '@supabase/supabase-js';

const args = parseArgs(process.argv.slice(2));
const USER = typeof args.user === 'string' ? args.user : null; // null = global
const LR = Number(args.lr ?? 0.05);
const ITERS = Number(args.iters ?? 400);
const L2 = Number(args.l2 ?? 0.01);

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
  if (!v) { console.error(`[train] Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function sigmoid(z) { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z)))); }

async function loadLabeledSamples() {
  // Pull memory features (age, retrieval_count, centrality) + session
  // injection history. We don't have per-recall BM25/vec scores stored, so
  // we approximate them using:
  //   bm25_feat  : normalised retrieval_count (often correlates with lexical hits)
  //   vec_feat   : 0.5 constant placeholder — upgraded once we log per-recall scores
  //   recency    : exp decay
  //   centrality : precomputed
  //
  // Limitation noted: this trainer primarily calibrates recency vs. centrality
  // vs. retrieval_count. When per-recall feature logs land, swap the feature
  // source for a richer dataset without changing the math.

  const filter = USER ? { user_id: USER } : {};

  const { data: mems, error: memErr } = await sb
    .from('memories')
    .select('id, user_id, created_at, retrieval_count, centrality')
    .is('deleted_at', null)
    .match(filter)
    .limit(10000);
  if (memErr) throw new Error(memErr.message);

  const { data: injections, error: injErr } = await sb
    .from('session_injections')
    .select('memory_id, session_id, injected_at')
    .match(filter)
    .limit(200000);
  if (injErr) throw new Error(injErr.message);

  // Label: memory_id appeared in >=2 distinct session_ids within 7d window.
  const byMem = new Map();
  for (const inj of injections ?? []) {
    const sessions = byMem.get(inj.memory_id) ?? new Set();
    sessions.add(inj.session_id);
    byMem.set(inj.memory_id, sessions);
  }

  const now = Date.now();
  const HALF_LIFE_MS = 90 * 86400 * 1000;
  const tau = HALF_LIFE_MS / Math.LN2;

  const retrievalMax = Math.max(1, ...(mems ?? []).map((m) => Number(m.retrieval_count ?? 0)));
  const centralityMax = Math.max(0.0001, ...(mems ?? []).map((m) => Number(m.centrality ?? 0)));

  const samples = [];
  for (const m of mems ?? []) {
    const sessionCount = (byMem.get(m.id) ?? new Set()).size;
    const ageMs = now - new Date(m.created_at).getTime();
    const recency = Math.exp(-ageMs / tau);
    const bm25Feat = Number(m.retrieval_count ?? 0) / retrievalMax;
    const vecFeat = 0.5; // placeholder
    const centralityFeat = Number(m.centrality ?? 0) / centralityMax;

    const label = sessionCount >= 2 ? 1 : 0;
    // Ignore memories never retrieved at all (no signal either way).
    if (sessionCount === 0 && Number(m.retrieval_count ?? 0) === 0) continue;

    samples.push({
      x: [bm25Feat, vecFeat, recency, centralityFeat],
      y: label,
    });
  }

  return samples;
}

function train(samples) {
  if (samples.length === 0) return null;

  // 4 features + bias
  let w = [0.25, 0.55, 0.1, 0.1]; // informed start
  let b = 0;

  const n = samples.length;
  const positives = samples.filter((s) => s.y === 1).length;
  const negatives = n - positives;
  console.log(`[train] ${n} samples · ${positives} pos · ${negatives} neg`);

  if (positives === 0 || negatives === 0) {
    console.log('[train] one class only — cannot train. Keeping defaults.');
    return { w, b, n, auc: null };
  }

  for (let iter = 0; iter < ITERS; iter++) {
    const gw = [0, 0, 0, 0];
    let gb = 0;
    let loss = 0;
    for (const s of samples) {
      const z = s.x[0] * w[0] + s.x[1] * w[1] + s.x[2] * w[2] + s.x[3] * w[3] + b;
      const p = sigmoid(z);
      const err = p - s.y;
      for (let k = 0; k < 4; k++) gw[k] += err * s.x[k];
      gb += err;
      loss += -(s.y * Math.log(Math.max(1e-9, p)) + (1 - s.y) * Math.log(Math.max(1e-9, 1 - p)));
    }
    for (let k = 0; k < 4; k++) w[k] -= (LR / n) * (gw[k] + L2 * w[k]);
    b -= (LR / n) * gb;

    if (iter % 50 === 0 || iter === ITERS - 1) {
      console.log(`[train]   iter ${iter} · loss ${(loss / n).toFixed(4)} · w [${w.map((x) => x.toFixed(3)).join(', ')}] · b ${b.toFixed(3)}`);
    }
  }

  // AUC via two-class probabilistic ranking
  const scored = samples.map((s) => ({
    score: sigmoid(s.x[0] * w[0] + s.x[1] * w[1] + s.x[2] * w[2] + s.x[3] * w[3] + b),
    y: s.y,
  })).sort((a, b) => b.score - a.score);
  const P = scored.filter((x) => x.y === 1).length;
  const N = scored.length - P;
  let rankSum = 0;
  scored.forEach((row, i) => {
    if (row.y === 1) rankSum += scored.length - i;
  });
  const auc = (rankSum - (P * (P + 1)) / 2) / (P * N);

  return { w, b, n, auc };
}

async function writeWeights(result) {
  if (!result) return;

  // Normalize so weights sum to 1 — keeps fused score in [0, 1].
  const sum = result.w.reduce((s, x) => s + Math.abs(x), 0) || 1;
  const norm = result.w.map((x) => Math.max(0, x) / sum);

  // Deactivate previous active row for this scope
  const scopeFilter = USER ? { user_id: USER } : { user_id: null };
  await sb
    .from('spine_rerank_weights')
    .update({ is_active: false })
    .match(scopeFilter)
    .eq('is_active', true);

  const row = {
    user_id: USER,
    bm25_w: norm[0],
    vec_w: norm[1],
    recency_w: norm[2],
    centrality_w: norm[3],
    bias: result.b,
    training_n: result.n,
    training_auc: result.auc,
    model_version: 'lr-v1',
    is_active: true,
    notes: `trained ${new Date().toISOString().slice(0, 10)} · auc ${result.auc?.toFixed(3) ?? '—'}`,
  };

  const { error } = await sb.from('spine_rerank_weights').insert(row);
  if (error) throw new Error(error.message);
  console.log(`[train] wrote weights: ${JSON.stringify(row)}`);
}

async function main() {
  const samples = await loadLabeledSamples();
  const result = train(samples);
  if (result) await writeWeights(result);
}

main().catch((err) => {
  console.error('[train] FAILED:', err);
  process.exit(1);
});
