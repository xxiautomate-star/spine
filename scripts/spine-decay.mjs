#!/usr/bin/env node
// npm run spine:decay
// Standalone decay runner — archives memories not accessed in 60 days.
// Loads .env.local directly so it works outside Next.js.
//
// Usage:
//   npm run spine:decay            # live run
//   npm run spine:decay -- --dry  # count without archiving

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Load .env.local ───────────────────────────────────────────────────────────

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const DECAY_DAYS = 60;
const dryRun = process.argv.includes('--dry');

// ── Client ────────────────────────────────────────────────────────────────────

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  SPINE DECAY  ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`  threshold    : ${DECAY_DAYS} days`);
  console.log(`  date         : ${new Date().toISOString()}\n`);

  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DECAY_DAYS);

  // Distinct users with active memories
  const { data: rows } = await sb
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .is('archived_at', null);

  if (!rows || rows.length === 0) {
    console.log('  No active memories found.');
    return;
  }

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  console.log(`  Users with active memories: ${userIds.length}\n`);

  let totalArchived = 0;
  let totalRevived = 0;
  const affected = [];

  for (const userId of userIds) {
    const { data: archived, error } = await sb.rpc('spine_archive_stale', {
      p_user: userId,
      p_threshold: threshold.toISOString(),
      p_dry_run: dryRun,
    });

    if (error) {
      console.error(`  ✗ ${userId.slice(0, 8)}  error: ${error.message}`);
      continue;
    }

    const count = archived ?? 0;
    if (count > 0) {
      totalArchived += count;
      affected.push({ userId: userId.slice(0, 8) + '...', count });
      console.log(`  ${dryRun ? '~' : '✓'} ${userId.slice(0, 8)}...  archived: ${count}`);
    }
  }

  console.log(`\n  ─────────────────────────────────`);
  console.log(`  Users affected : ${affected.length}`);
  console.log(`  Archived       : ${totalArchived}${dryRun ? ' (would be)' : ''}`);
  console.log(`  Revived        : ${totalRevived}`);
  if (dryRun) {
    console.log('\n  Re-run without --dry to apply.\n');
  } else {
    console.log('\n  Done.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
