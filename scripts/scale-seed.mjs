#!/usr/bin/env node
// Seeds N synthetic memories into a dedicated bench user in Supabase.
// Resume-safe: queries how many bench rows already exist and picks up there.
//
// Usage:
//   node scripts/scale-seed.mjs --count 10000
//   node scripts/scale-seed.mjs --count 1000000 --batch 500 --embed-batch 100
//
// Env required:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY
//   SPINE_BENCH_USER_ID        — the auth.users UUID memories get written under
//
// Cost: ~$1 per 1M memories on text-embedding-3-small ($0.00002 / 1K tokens).

import { createClient } from '@supabase/supabase-js';
import { generateMemory } from './scale-corpus.mjs';

const args = parseArgs(process.argv.slice(2));
const COUNT = Number(args.count ?? 10_000);
const INSERT_BATCH = Number(args.batch ?? 500);
const EMBED_BATCH = Number(args['embed-batch'] ?? 100);
const START_AT = Number(args.start ?? 0);

const EMBED_MODEL = 'text-embedding-3-small';
const EMBED_DIMS = 1536;

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
    console.error(`[scale-seed] Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_KEY = must('OPENAI_API_KEY');
const BENCH_USER = must('SPINE_BENCH_USER_ID');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function insertRows(rows) {
  const { error } = await supabase.from('memories').insert(rows);
  if (error) throw new Error(`insert failed: ${error.message}`);
}

async function resumeOffset() {
  if (START_AT > 0) return START_AT;
  const { count } = await supabase
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', BENCH_USER)
    .eq('is_bench', true);
  return count ?? 0;
}

function pct(n, d) {
  return d === 0 ? '0%' : ((n / d) * 100).toFixed(1) + '%';
}

async function main() {
  console.log(`[scale-seed] Target: ${COUNT.toLocaleString()} memories under bench user ${BENCH_USER}`);
  const resumeAt = await resumeOffset();
  console.log(`[scale-seed] Resuming at ${resumeAt.toLocaleString()} (start ${START_AT.toLocaleString()})`);

  const remaining = Math.max(0, COUNT - resumeAt);
  if (remaining === 0) {
    console.log('[scale-seed] Target already reached.');
    return;
  }

  const t0 = Date.now();
  let inserted = 0;

  for (let offset = 0; offset < remaining; offset += INSERT_BATCH) {
    const batchSize = Math.min(INSERT_BATCH, remaining - offset);
    const items = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = resumeAt + offset + i;
      items.push(generateMemory(idx));
    }

    // Embed in sub-batches
    const contents = items.map((m) => m.content);
    const embeddings = [];
    for (let i = 0; i < contents.length; i += EMBED_BATCH) {
      const slice = contents.slice(i, i + EMBED_BATCH);
      const vecs = await embedBatch(slice);
      for (const v of vecs) embeddings.push(v);
    }

    const rows = items.map((m, i) => ({
      user_id: BENCH_USER,
      content: m.content,
      source: m.source,
      tags: m.tags,
      embedding: embeddings[i],
      is_bench: true,
    }));

    await insertRows(rows);
    inserted += rows.length;

    const elapsed = (Date.now() - t0) / 1000;
    const rate = inserted / elapsed;
    const eta = (remaining - inserted) / Math.max(1, rate);
    console.log(
      `[scale-seed] ${inserted.toLocaleString()} / ${remaining.toLocaleString()} ` +
        `(${pct(inserted, remaining)}) · ${rate.toFixed(1)}/s · ETA ${Math.round(eta)}s`
    );
  }

  const total = (Date.now() - t0) / 1000;
  console.log(
    `[scale-seed] Done. Inserted ${inserted.toLocaleString()} in ${total.toFixed(1)}s ` +
      `(${(inserted / total).toFixed(1)}/s).`
  );
}

main().catch((err) => {
  console.error('[scale-seed] FAILED:', err);
  process.exit(1);
});
