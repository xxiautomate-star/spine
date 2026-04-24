#!/usr/bin/env node
// Leak audit — proves the public /spine search endpoints return ONLY rows
// owned by SPINE_DEMO_USER_ID. Runs 20 diverse queries including some
// adversarially targeted at Roman's real corpus vocabulary. Fails (exit
// code 2) if any result row's user_id is not the demo user.
//
// Usage:
//   export SPINE_SITE_URL=https://spine.xxiautomate.com
//   export SPINE_DEMO_USER_ID=<uuid>
//   export SUPABASE_SERVICE_ROLE_KEY=<sk>
//   node scripts/leak-audit.mjs

import { createClient } from '@supabase/supabase-js';

function must(name) {
  const v = process.env[name];
  if (!v) { console.error(`[leak-audit] Missing env: ${name}`); process.exit(1); }
  return v;
}
const SITE = must('SPINE_SITE_URL').replace(/\/$/, '');
const DEMO_USER = must('SPINE_DEMO_USER_ID');
const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const QUERIES = [
  // neutral
  'what is the retrieval pipeline',
  'how does the ranker work',
  'install command',
  'cross-encoder provider',
  'pgvector',
  'what is append-only',
  // adversarial — targeted at personal / non-demo content
  'roman',
  'xxiautomate',
  'stripe',
  'claude code',
  'fragment',
  'shader',
  'design law',
  'how old is roman',
  // typos / edge cases
  'spine',
  'why spine',
  'help',
  'engine',
  'memory',
  '',
];

async function hitEndpoint(path, q) {
  const url = `${SITE}${path}?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'user-agent': 'spine-leak-audit/1' } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function lookupOwners(memoryIds) {
  if (memoryIds.length === 0) return new Map();
  const { data, error } = await sb
    .from('memories')
    .select('id, user_id, is_bench')
    .in('id', memoryIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.id, { user_id: r.user_id, is_bench: r.is_bench }]));
}

async function audit(path) {
  console.log(`\n[leak-audit] ── ${path} ────────────────────────`);
  let leakCount = 0;
  let checked = 0;
  const leaks = [];

  for (const q of QUERIES) {
    const { status, data } = await hitEndpoint(path, q);
    if (status === 400 && q === '') continue; // empty query is expected to 400
    if (!data || (!Array.isArray(data.memories) && !Array.isArray(data.pool))) continue;
    const rows = Array.isArray(data.memories) ? data.memories : data.pool;
    const ids = rows.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) continue;

    const owners = await lookupOwners(ids);
    for (const id of ids) {
      const owner = owners.get(id);
      checked++;
      if (!owner) continue;
      if (owner.user_id !== DEMO_USER) {
        leakCount++;
        leaks.push({ query: q, id, actualUser: owner.user_id, is_bench: owner.is_bench });
      }
    }
  }

  console.log(`[leak-audit] ${path} — checked ${checked} rows · leaks ${leakCount}`);
  if (leakCount > 0) {
    console.log('[leak-audit] LEAKS:');
    for (const l of leaks.slice(0, 10)) console.log('  ', l);
  }
  return leakCount;
}

async function main() {
  console.log(`[leak-audit] site=${SITE} demo_user=${DEMO_USER}`);
  const leaksSearch = await audit('/api/spine/search');
  const leaksCand = await audit('/api/spine/candidates');
  const total = leaksSearch + leaksCand;
  if (total > 0) {
    console.error(`\n[leak-audit] FAIL — ${total} leaked rows across endpoints.`);
    process.exit(2);
  }
  console.log('\n[leak-audit] ✓ PASS — no leakage detected across all test queries.');
}

main().catch((err) => {
  console.error('[leak-audit] harness error:', err);
  process.exit(1);
});
