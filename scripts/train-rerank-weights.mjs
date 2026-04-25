#!/usr/bin/env node
// Train rerank weights on REAL labels from the /api/spine-feedback pipeline.
//
// Data source: spine_training_samples view (migration 015) which joins
//   saas_spine_recall_queries ↔ saas_spine_recall_candidates ↔ saas_spine_recall_labels.
// Each candidate becomes one training row: features = the 4 normalised
// signals that were logged at recall time, label = was_used (quoted_phrase
// match in the user's next turn within 10 min).
//
// Algorithm: batch logistic regression with L2 regularisation, pure-JS SGD.
// Writes a new row to spine_rerank_weights with model_version='lr-v2-real'
// and flips the prior active row inactive.
//
// Usage:
//   node scripts/train-rerank-weights.mjs                  # global default
//   node scripts/train-rerank-weights.mjs --user <uuid>    # per-user
//   node scripts/train-rerank-weights.mjs --min 50         # abort if fewer than N positives
//   node scripts/train-rerank-weights.mjs --demo           # include is_demo queries

import { createClient } from '@supabase/supabase-js';

const args = parseArgs(process.argv.slice(2));
const USER = typeof args.user === 'string' ? args.user : null;
const MIN_POSITIVES = Number(args.min ?? 20);
const INCLUDE_DEMO = Boolean(args.demo);
const LR = Number(args.lr ?? 0.1);
const ITERS = Number(args.iters ?? 600);
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

async function loadSamples() {
  // Read from the training-samples view. Filter by user if scoped, and by
  // is_demo if caller didn't opt in to demo traffic (which mixes contexts).
  let q = sb.from('spine_training_samples').select('user_id, query, why_bm25, why_vec, why_recency, why_centrality, cross_encoder_score, label, rank_shown');
  if (USER) q = q.eq('user_id', USER);

  // Grab in pages because view rows can be large.
  const pageSize = 2000;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > 200_000) break;
  }
  return all;
}

function train(samples) {
  const n = samples.length;
  if (n === 0) return null;

  const positives = samples.filter((s) => s.label === true).length;
  const negatives = n - positives;
  console.log(`[train] ${n} candidates · ${positives} positive · ${negatives} negative`);
  if (positives < MIN_POSITIVES) {
    console.log(`[train] fewer than ${MIN_POSITIVES} positives — refusing to train. Collect more data first.`);
    return null;
  }

  // Class weighting: positives are rare, upweight them to 1:1 effective ratio.
  const posWeight = negatives / Math.max(1, positives);

  let w = [0.25, 0.55, 0.1, 0.1];
  let b = 0;

  for (let iter = 0; iter < ITERS; iter++) {
    const gw = [0, 0, 0, 0];
    let gb = 0;
    let loss = 0;
    for (const s of samples) {
      const x = [
        Number(s.why_bm25 ?? 0),
        Number(s.why_vec ?? 0),
        Number(s.why_recency ?? 0),
        Number(s.why_centrality ?? 0),
      ];
      const y = s.label ? 1 : 0;
      const weight = y === 1 ? posWeight : 1;

      const z = x[0] * w[0] + x[1] * w[1] + x[2] * w[2] + x[3] * w[3] + b;
      const p = sigmoid(z);
      const err = (p - y) * weight;
      for (let k = 0; k < 4; k++) gw[k] += err * x[k];
      gb += err;
      loss += weight * -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));
    }
    for (let k = 0; k < 4; k++) w[k] -= (LR / n) * (gw[k] + L2 * w[k]);
    b -= (LR / n) * gb;

    if (iter % 100 === 0 || iter === ITERS - 1) {
      console.log(`[train]   iter ${iter} · loss ${(loss / n).toFixed(4)} · w [${w.map((x) => x.toFixed(3)).join(', ')}] · b ${b.toFixed(3)}`);
    }
  }

  // AUC via pairwise ranking.
  const scored = samples.map((s) => {
    const x = [Number(s.why_bm25 ?? 0), Number(s.why_vec ?? 0), Number(s.why_recency ?? 0), Number(s.why_centrality ?? 0)];
    const z = x[0] * w[0] + x[1] * w[1] + x[2] * w[2] + x[3] * w[3] + b;
    return { score: sigmoid(z), y: s.label ? 1 : 0 };
  }).sort((a, b) => b.score - a.score);

  const P = scored.filter((r) => r.y === 1).length;
  const N = scored.length - P;
  let rankSum = 0;
  scored.forEach((row, i) => {
    if (row.y === 1) rankSum += scored.length - i;
  });
  const auc = (rankSum - (P * (P + 1)) / 2) / Math.max(1, P * N);

  return { w, b, n, auc, positives, negatives };
}

async function writeWeights(result) {
  if (!result) return;

  // Keep weights non-negative, normalise so they sum to 1 (stable fused range).
  const raw = result.w.map((x) => Math.max(0, x));
  const sum = raw.reduce((s, x) => s + x, 0) || 1;
  const norm = raw.map((x) => x / sum);

  const scopeMatch = USER ? { user_id: USER } : { user_id: null };
  await sb
    .from('spine_rerank_weights')
    .update({ is_active: false })
    .match(scopeMatch)
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
    model_version: 'lr-v2-real',
    is_active: true,
    notes: `trained ${new Date().toISOString().slice(0, 10)} · auc ${result.auc.toFixed(3)} · ${result.positives}p/${result.negatives}n`,
  };
  const { error } = await sb.from('spine_rerank_weights').insert(row);
  if (error) throw new Error(error.message);
  console.log(`[train] ✓ wrote new active weights — auc=${result.auc.toFixed(3)}`);
  console.log(`[train] weights: bm25=${norm[0].toFixed(3)} vec=${norm[1].toFixed(3)} recency=${norm[2].toFixed(3)} centrality=${norm[3].toFixed(3)} bias=${result.b.toFixed(3)}`);
}

async function main() {
  console.log(`[train] scope: ${USER ?? 'global'} · include_demo=${INCLUDE_DEMO} · min_positives=${MIN_POSITIVES}`);
  const samples = await loadSamples();
  const result = train(samples);
  if (result) await writeWeights(result);
}

main().catch((err) => {
  console.error('[train] FAILED:', err);
  process.exit(1);
});
