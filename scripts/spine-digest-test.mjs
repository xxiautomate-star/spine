#!/usr/bin/env node
// npm run spine:digest-test
// Sends the weekly retention email to a single user for manual QA.
// Loads .env.local directly so it works outside Next.js.
//
// Usage:
//   npm run spine:digest-test                        # sends to first active user
//   npm run spine:digest-test -- --email you@x.com  # sends to specific address
//   npm run spine:digest-test -- --dry               # renders HTML, no send

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry');
const emailArgIdx = process.argv.indexOf('--email');
const overrideEmail = emailArgIdx !== -1 ? process.argv[emailArgIdx + 1] : null;

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── Inline gatherRetentionData (mirrors lib/retention-email.ts) ──────────────

const DECAY_DAYS = 60;

async function gatherRetentionData(userId, userEmail) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(now.getTime() - (DECAY_DAYS - 14) * 24 * 60 * 60 * 1000);

  const [totalRes, weekRes, conflictResolvedRes, unresolvedRes, staleRes, archivedRes, entitiesRes, oldestRes] =
    await Promise.all([
      sb.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null).is('archived_at', null),
      sb.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null).gte('created_at', weekAgo.toISOString()),
      sb.from('memory_conflicts').select('id', { count: 'exact', head: true }).eq('user_id', userId).not('resolution', 'is', null).gte('resolved_at', weekAgo.toISOString()),
      sb.from('memory_conflicts').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('resolution', null),
      sb.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null).is('archived_at', null).lt('last_accessed_at', staleThreshold.toISOString()),
      sb.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('deleted_at', null).not('archived_at', 'is', null),
      sb.from('entity_nodes').select('name, type, mention_count').eq('user_id', userId).order('mention_count', { ascending: false }).limit(5),
      sb.from('memories').select('id, content, created_at').eq('user_id', userId).is('deleted_at', null).is('archived_at', null).order('created_at', { ascending: true }).limit(1),
    ]);

  const buckets = [
    { label: '< 1 week', days: 7 },
    { label: '1–2 weeks', days: 14 },
    { label: '2–4 weeks', days: 28 },
    { label: '1–2 months', days: 60 },
    { label: '> 2 months', days: Infinity },
  ];

  const histogramCounts = await Promise.all(
    buckets.map(async (b, i) => {
      const prev = i === 0 ? now : new Date(now.getTime() - buckets[i - 1].days * 24 * 60 * 60 * 1000);
      const curr = b.days === Infinity ? new Date(0) : new Date(now.getTime() - b.days * 24 * 60 * 60 * 1000);
      const { count } = await sb
        .from('memories').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).is('deleted_at', null).is('archived_at', null)
        .lt('created_at', prev.toISOString()).gte('created_at', curr.toISOString());
      return { label: b.label, count: count ?? 0 };
    })
  );

  const oldestRow = oldestRes.data?.[0];
  const oldestActive = oldestRow ? {
    id: oldestRow.id,
    content: oldestRow.content.slice(0, 120),
    daysAgo: Math.round((now.getTime() - new Date(oldestRow.created_at).getTime()) / 86400000),
  } : null;

  return {
    userId, email: userEmail,
    totalMemories: totalRes.count ?? 0,
    capturedThisWeek: weekRes.count ?? 0,
    conflictsResolvedThisWeek: conflictResolvedRes.count ?? 0,
    unresolvedConflicts: unresolvedRes.count ?? 0,
    staleCount: staleRes.count ?? 0,
    archivedCount: archivedRes.count ?? 0,
    ageHistogram: histogramCounts,
    topEntities: (entitiesRes.data ?? []).map((e) => ({ name: e.name, type: e.type, count: e.mention_count })),
    oldestActive,
  };
}

// ── Send via Resend (raw fetch, no SDK) ───────────────────────────────────────

async function sendTestEmail(to, subject, html, text) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set.');
  const from = process.env.RESEND_FROM_ADDRESS ?? 'Spine <noreply@spine.xxiautomate.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

// ── Simple email builder (simplified version for test script) ─────────────────

function histogramBar(count, max) {
  if (max === 0) return '';
  const pct = Math.round((count / max) * 100);
  const blocks = Math.round(pct / 10);
  return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

function buildTestEmail(data) {
  const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';
  const maxCount = Math.max(...data.ageHistogram.map((b) => b.count), 1);
  const dateStr = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  const captureVerb = data.capturedThisWeek === 0 ? 'Nothing captured this week.'
    : data.capturedThisWeek === 1 ? '1 new memory'
    : `${data.capturedThisWeek} new memories`;

  const histogramRows = data.ageHistogram
    .filter((b) => b.count > 0)
    .map((b) => `<tr>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.35);padding-right:14px;white-space:nowrap;">${b.label}</td>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,154,60,0.65);">${histogramBar(b.count, maxCount)}</td>
      <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.35);padding-left:10px;">${b.count}</td>
    </tr>`).join('');

  const staleAlert = data.staleCount > 0
    ? `<p style="margin:16px 0 8px;color:#E89A3C;">⚠ ${data.staleCount} memories approaching decay (${DECAY_DAYS}-day threshold). <a href="${BASE}/timeline?filter=stale" style="color:#E89A3C;">Review →</a></p>`
    : '';

  const conflictAlert = data.unresolvedConflicts > 0
    ? `<p style="margin:8px 0 16px;color:rgba(232,228,221,0.5);">⚡ ${data.unresolvedConflicts} unresolved conflicts. <a href="${BASE}/timeline?conflicts=1" style="color:#E89A3C;">Resolve →</a></p>`
    : '';

  const body = `<!DOCTYPE html>
<html><body style="background:#0D0C0A;color:#E8E4DD;font-family:Georgia,serif;max-width:540px;margin:0 auto;padding:40px 24px;">
  <p style="font-family:'Courier New',monospace;font-size:10px;color:rgba(232,154,60,0.55);letter-spacing:0.12em;text-transform:uppercase;">Spine · Weekly Archive</p>
  <h1 style="font-size:28px;margin:8px 0 4px;">${captureVerb}${data.capturedThisWeek > 0 ? ` — ${data.totalMemories.toLocaleString()} total` : ''}</h1>
  <p style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.3);margin:0 0 24px;">${dateStr}</p>

  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
    <tr>
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
        <span style="font-size:24px;color:#E8E4DD;">${data.capturedThisWeek}</span>
        <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">captured</span>
      </td>
      <td style="padding:12px 16px 12px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
        <span style="font-size:24px;color:#E8E4DD;">${data.conflictsResolvedThisWeek}</span>
        <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">resolved</span>
      </td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
        <span style="font-size:24px;color:#E8E4DD;">${data.totalMemories.toLocaleString()}</span>
        <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">total</span>
      </td>
    </tr>
  </table>

  ${staleAlert}${conflictAlert}

  <p style="font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.25);text-transform:uppercase;letter-spacing:0.1em;margin:24px 0 8px;">Memory age distribution</p>
  <div style="background:rgba(232,228,221,0.02);border:1px solid rgba(232,228,221,0.06);border-radius:8px;padding:16px;">
    <table style="border-collapse:collapse;">
      ${histogramRows || '<tr><td style="color:rgba(232,228,221,0.3);font-size:12px;font-family:Courier New,monospace;">No memories yet.</td></tr>'}
    </table>
  </div>

  ${data.topEntities.length > 0 ? `
  <p style="font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.25);text-transform:uppercase;letter-spacing:0.1em;margin:24px 0 8px;">Most referenced</p>
  <div style="background:rgba(232,228,221,0.02);border:1px solid rgba(232,228,221,0.06);border-radius:8px;padding:16px;">
    ${data.topEntities.map((e) => `<span style="display:inline-block;margin:0 8px 6px 0;padding:3px 10px;border:1px solid rgba(232,228,221,0.08);border-radius:20px;font-size:12px;color:rgba(232,228,221,0.6);">${e.name} <span style="color:rgba(232,228,221,0.3);font-size:10px;">${e.count}×</span></span>`).join('')}
  </div>` : ''}

  <a href="${BASE}/timeline" style="display:inline-block;margin-top:32px;padding:10px 20px;border:1px solid rgba(232,154,60,0.3);color:#E89A3C;font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;text-decoration:none;">Open your archive →</a>

  <p style="margin-top:32px;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.15);">Spine · memory layer for AI · <a href="${BASE}/billing" style="color:rgba(232,228,221,0.2);">manage emails</a></p>
</body></html>`;

  const text = `Spine weekly: ${data.capturedThisWeek} captured, ${data.totalMemories} total, ${data.unresolvedConflicts} conflicts unresolved. ${BASE}/timeline`;

  return { subject: `Your Spine archive — ${data.capturedThisWeek} captured this week`, html: body, text };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  SPINE DIGEST TEST  ${dryRun ? '(DRY RUN)' : '(SENDING)'}\n`);

  let userId, userEmail;

  if (overrideEmail) {
    // Find user by email in auth
    const { data: { users }, error } = await sb.auth.admin.listUsers({ perPage: 500 });
    if (error) throw error;
    const found = users.find((u) => u.email?.toLowerCase() === overrideEmail.toLowerCase());
    if (!found) {
      console.error(`✗ No user found with email: ${overrideEmail}`);
      process.exit(1);
    }
    userId = found.id;
    userEmail = found.email;
  } else {
    // Find first user with memories
    const { data: rows } = await sb
      .from('memories').select('user_id').is('deleted_at', null).limit(1);
    if (!rows || rows.length === 0) {
      console.error('✗ No active memories found. Capture something first.');
      process.exit(1);
    }
    userId = rows[0].user_id;
    const { data: authUser } = await sb.auth.admin.getUserById(userId);
    userEmail = authUser?.user?.email;
    if (!userEmail) {
      console.error(`✗ Could not resolve email for user ${userId}`);
      process.exit(1);
    }
  }

  console.log(`  User  : ${userId.slice(0, 8)}...`);
  console.log(`  Email : ${userEmail}\n`);

  const data = await gatherRetentionData(userId, userEmail);

  console.log(`  Total memories        : ${data.totalMemories}`);
  console.log(`  Captured this week    : ${data.capturedThisWeek}`);
  console.log(`  Conflicts resolved    : ${data.conflictsResolvedThisWeek}`);
  console.log(`  Unresolved conflicts  : ${data.unresolvedConflicts}`);
  console.log(`  Stale (near decay)    : ${data.staleCount}`);
  console.log(`  Archived              : ${data.archivedCount}`);
  console.log(`  Top entities          : ${data.topEntities.map((e) => e.name).join(', ') || 'none'}\n`);

  const { subject, html, text } = buildTestEmail(data);

  if (dryRun) {
    const outPath = resolve(process.cwd(), 'scripts', 'digest-preview.html');
    writeFileSync(outPath, html, 'utf8');
    console.log(`  Dry run — HTML written to: ${outPath}`);
    console.log(`  Subject: ${subject}\n`);
    console.log('  Re-run without --dry to send.\n');
    return;
  }

  if (!RESEND_API_KEY) {
    console.error('✗ RESEND_API_KEY not set. Add it to .env.local.');
    process.exit(1);
  }

  console.log(`  Sending to ${userEmail}...`);
  const result = await sendTestEmail(userEmail, subject, html, text);
  console.log(`  ✓ Sent! ID: ${result.id ?? JSON.stringify(result)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
