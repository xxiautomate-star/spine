#!/usr/bin/env node
// Self-test: verify a user cannot see or delete another user's memories through
// the API-key-authenticated routes. Creates two auth users, mints a key for each,
// captures one memory per user, and asserts isolation.
//
// Required env (set in .env.local.test or exported before invocation):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   OPENAI_API_KEY
//   SPINE_TEST_BASE_URL   (e.g. http://localhost:3000)

import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env.local');
if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const BASE = process.env.SPINE_TEST_BASE_URL || 'http://localhost:3000';
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SRK) {
  console.error('[test:dashboard] missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('[test:dashboard] missing OPENAI_API_KEY (cloud capture embeds server-side)');
  process.exit(1);
}

const admin = createClient(URL, SRK, { auth: { persistSession: false } });

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function rawKey() {
  return `spine_live_${randomBytes(18).toString('base64url')}`;
}

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(12).toString('base64url'),
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}

async function mintKey(userId, name) {
  const raw = rawKey();
  const { data, error } = await admin
    .from('api_keys')
    .insert({ user_id: userId, key_hash: hashKey(raw), name })
    .select('id')
    .single();
  if (error || !data) throw new Error(`mintKey: ${error?.message}`);
  return { raw, id: data.id };
}

async function post(path, key, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function main() {
  const run = randomBytes(4).toString('hex');
  const emailA = `spine-test-a-${run}@example.test`;
  const emailB = `spine-test-b-${run}@example.test`;

  console.log(`[setup] creating users ${emailA} / ${emailB}`);
  const userA = await createUser(emailA);
  const userB = await createUser(emailB);
  const keyA = await mintKey(userA.id, 'test-a');
  const keyB = await mintKey(userB.id, 'test-b');

  const failures = [];
  const ok = (label) => console.log(`  ok  ${label}`);
  const fail = (label, reason) => {
    console.log(`  FAIL ${label} — ${reason}`);
    failures.push(label);
  };

  try {
    console.log('[capture] one memory per user');
    const capA = await post('/api/capture', keyA.raw, {
      content: `userA-secret-${run}: the launch date is tuesday`,
      source: 'test',
    });
    const capB = await post('/api/capture', keyB.raw, {
      content: `userB-secret-${run}: the launch date is friday`,
      source: 'test',
    });
    if (capA.status !== 200 || !capA.body.id) fail('capture A', JSON.stringify(capA));
    else ok('capture A');
    if (capB.status !== 200 || !capB.body.id) fail('capture B', JSON.stringify(capB));
    else ok('capture B');

    const idA = capA.body.id;
    const idB = capB.body.id;

    console.log('[recall] each user only sees their own memory');
    const recA = await post('/api/recall', keyA.raw, { query: 'launch date', limit: 10 });
    const recB = await post('/api/recall', keyB.raw, { query: 'launch date', limit: 10 });

    const idsA = (recA.body.memories ?? []).map((m) => m.id);
    const idsB = (recB.body.memories ?? []).map((m) => m.id);

    if (!idsA.includes(idA)) fail('recall A contains own', `got ${JSON.stringify(idsA)}`);
    else ok('recall A contains own');
    if (idsA.includes(idB)) fail('recall A leaks B', `got ${JSON.stringify(idsA)}`);
    else ok('recall A excludes B');
    if (!idsB.includes(idB)) fail('recall B contains own', `got ${JSON.stringify(idsB)}`);
    else ok('recall B contains own');
    if (idsB.includes(idA)) fail('recall B leaks A', `got ${JSON.stringify(idsB)}`);
    else ok('recall B excludes A');

    console.log('[timeline] each user only sees their own memory');
    const tlA = await post('/api/timeline', keyA.raw, { limit: 50 });
    const tlB = await post('/api/timeline', keyB.raw, { limit: 50 });
    const tlIdsA = (tlA.body.memories ?? []).map((m) => m.id);
    const tlIdsB = (tlB.body.memories ?? []).map((m) => m.id);
    if (tlIdsA.includes(idB)) fail('timeline A leaks B', JSON.stringify(tlIdsA));
    else ok('timeline A excludes B');
    if (tlIdsB.includes(idA)) fail('timeline B leaks A', JSON.stringify(tlIdsB));
    else ok('timeline B excludes A');

    console.log('[forget] cross-user delete is a no-op');
    const forgetCross = await post('/api/forget', keyA.raw, { id: idB });
    if (forgetCross.status === 200 && forgetCross.body.forgotten === false) ok('forget A→B returns forgotten:false');
    else fail('forget A→B', JSON.stringify(forgetCross));

    const { data: stillThere } = await admin
      .from('memories')
      .select('id, deleted_at')
      .eq('id', idB)
      .single();
    if (stillThere && stillThere.deleted_at === null) ok('B memory survived A forget attempt');
    else fail('B memory survived', JSON.stringify(stillThere));

    console.log('[forget] same-user delete works');
    const forgetOwn = await post('/api/forget', keyA.raw, { id: idA });
    if (forgetOwn.status === 200 && forgetOwn.body.forgotten === true) ok('forget A→A returns forgotten:true');
    else fail('forget A→A', JSON.stringify(forgetOwn));
  } finally {
    console.log('[teardown] deleting test users');
    await admin.auth.admin.deleteUser(userA.id).catch(() => {});
    await admin.auth.admin.deleteUser(userB.id).catch(() => {});
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nall passed — user isolation holds across recall, timeline, forget.');
}

main().catch((err) => {
  console.error('[test:dashboard] unhandled error:', err);
  process.exit(1);
});
