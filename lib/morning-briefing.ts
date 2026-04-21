// Morning briefing — assembled once per user per day.
// Sent via Slack webhook (if configured) and/or email.
// Tone: military briefing. Concise. Actionable. No fluff.

import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, FROM_ADDRESS } from './resend';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';

// ── Data ─────────────────────────────────────────────────────────────────────

interface BriefingData {
  userId: string;
  email: string;
  slackWebhook: string | null;
  yesterday: {
    total: number;
    byType: Record<string, number>;
    lastMemory: { content: string; type: string | null; created_at: string } | null;
  };
  unresolvedDecisions: number;
  totalMemories: number;
  streakDays: number;
}

export async function gatherBriefingData(
  sb: SupabaseClient,
  userId: string,
  userEmail: string
): Promise<BriefingData> {
  const now = new Date();
  const ydStart = new Date(now);
  ydStart.setDate(ydStart.getDate() - 1);
  ydStart.setHours(0, 0, 0, 0);
  const ydEnd = new Date(now);
  ydEnd.setHours(0, 0, 0, 0);

  const [profileRes, yesterdayRes, totalRes, unresolvedRes] = await Promise.all([
    // Slack webhook
    sb.from('profiles').select('slack_webhook').eq('user_id', userId).maybeSingle(),

    // Yesterday's memories with type
    sb.from('memories')
      .select('id, content, type, created_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('created_at', ydStart.toISOString())
      .lt('created_at', ydEnd.toISOString())
      .order('created_at', { ascending: false }),

    // Total memory count
    sb.from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null),

    // Unresolved decisions: decision memories with no follow-up in 48h
    sb.from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'decision')
      .is('deleted_at', null)
      .lt('created_at', new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const yesterdayMems = yesterdayRes.data ?? [];
  const byType: Record<string, number> = {};
  for (const m of yesterdayMems) {
    const t = (m.type as string | null) ?? 'context';
    byType[t] = (byType[t] ?? 0) + 1;
  }

  // Streak: count consecutive days with at least 1 memory
  const { data: recentDays } = await sb
    .from('spine_memories')
    .select('created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });

  const days = new Set((recentDays ?? []).map((r) => (r.created_at as string).slice(0, 10)));
  let streak = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (days.has(d.toISOString().slice(0, 10))) streak++;
    else break;
  }

  return {
    userId,
    email: userEmail,
    slackWebhook: (profileRes.data?.slack_webhook as string | null) ?? null,
    yesterday: {
      total: yesterdayMems.length,
      byType,
      lastMemory: yesterdayMems[0]
        ? { content: (yesterdayMems[0].content as string).slice(0, 200), type: yesterdayMems[0].type as string | null, created_at: yesterdayMems[0].created_at as string }
        : null,
    },
    unresolvedDecisions: (unresolvedRes.count ?? 0),
    totalMemories: (totalRes.count ?? 0),
    streakDays: streak,
  };
}

// ── Slack ─────────────────────────────────────────────────────────────────────

function typeEmoji(type: string): string {
  const map: Record<string, string> = { decision: '🔷', bug: '🐛', feature: '✨', context: '📝', fact: '📌' };
  return map[type] ?? '📝';
}

function buildSlackText(data: BriefingData, dateLabel: string): string {
  const lines: string[] = [
    `*Spine Briefing · ${dateLabel}*`,
    '',
  ];

  if (data.yesterday.total === 0) {
    lines.push('No memories captured yesterday. Start a session today.');
  } else {
    lines.push(`Yesterday: *${data.yesterday.total} ${data.yesterday.total === 1 ? 'memory' : 'memories'}* captured`);
    const breakdown = Object.entries(data.yesterday.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${typeEmoji(t)} ${n} ${t}`)
      .join('  ·  ');
    if (breakdown) lines.push(breakdown);
  }

  if (data.yesterday.lastMemory) {
    lines.push('');
    lines.push(`_Last session: "${data.yesterday.lastMemory.content.replace(/\n/g, ' ').slice(0, 120)}…"_`);
  }

  if (data.unresolvedDecisions > 0) {
    lines.push('');
    lines.push(`⚠ *${data.unresolvedDecisions} unresolved ${data.unresolvedDecisions === 1 ? 'decision' : 'decisions'}* pending follow-up`);
  }

  if (data.streakDays >= 3) {
    lines.push('');
    lines.push(`🔥 ${data.streakDays}-day capture streak`);
  }

  lines.push('');
  lines.push(`<${APP_URL}/timeline|Open Timeline>  ·  <${APP_URL}/replay|Replay a File>  ·  <${APP_URL}/search|Search Memory>`);

  return lines.join('\n');
}

export async function sendSlackBriefing(webhook: string, data: BriefingData, dateLabel: string): Promise<boolean> {
  const text = buildSlackText(data, dateLabel);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

function buildEmailHtml(data: BriefingData, dateLabel: string): string {
  const typeRows = Object.entries(data.yesterday.byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span style="font-family:monospace;font-size:11px;color:rgba(232,228,221,0.5);margin-right:16px;">${typeEmoji(t)} ${n} ${t}</span>`)
    .join('');

  const lastMem = data.yesterday.lastMemory
    ? `<div style="margin:24px 0;padding:14px 18px;border-left:2px solid rgba(232,154,60,0.4);background:rgba(232,154,60,0.04);">
        <p style="margin:0;font-size:13px;font-style:italic;color:rgba(232,228,221,0.55);line-height:1.6;">"${data.yesterday.lastMemory.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</p>
       </div>`
    : '';

  const unresolvedNote = data.unresolvedDecisions > 0
    ? `<p style="font-family:monospace;font-size:11px;color:rgba(248,113,113,0.7);margin:16px 0 0;">⚠ ${data.unresolvedDecisions} unresolved ${data.unresolvedDecisions === 1 ? 'decision' : 'decisions'} pending follow-up</p>`
    : '';

  const streakNote = data.streakDays >= 3
    ? `<p style="font-family:monospace;font-size:11px;color:rgba(232,154,60,0.6);margin:12px 0 0;">🔥 ${data.streakDays}-day capture streak</p>`
    : '';

  const nothingNote = data.yesterday.total === 0
    ? `<p style="font-family:Georgia,serif;font-size:16px;color:rgba(232,228,221,0.5);font-style:italic;">No memories captured yesterday.</p>`
    : `<p style="font-size:15px;color:rgba(232,228,221,0.85);margin-bottom:8px;"><strong>${data.yesterday.total} ${data.yesterday.total === 1 ? 'memory' : 'memories'}</strong> captured yesterday</p><div style="margin-bottom:4px;">${typeRows}</div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spine Briefing · ${dateLabel}</title></head>
<body style="margin:0;padding:0;background:#0D0C0A;color:#E8E4DD;font-family:Georgia,'Times New Roman',serif;">
<div style="max-width:560px;margin:0 auto;padding:40px 24px;">
  <div style="margin-bottom:32px;">
    <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#E89A3C;margin-right:8px;vertical-align:middle;"></span>
    <span style="font-family:Georgia,serif;font-size:16px;color:#E8E4DD;">Spine</span>
  </div>
  <p style="font-family:monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:rgba(232,154,60,0.55);margin-bottom:8px;">Morning Briefing · ${dateLabel}</p>
  <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:normal;font-style:italic;color:rgba(232,228,221,0.9);line-height:1.2;margin:0 0 32px;">Your memory, updated.</h1>
  ${nothingNote}
  ${lastMem}
  ${unresolvedNote}
  ${streakNote}
  <div style="margin-top:32px;display:flex;gap:12px;flex-wrap:wrap;">
    <a href="${APP_URL}/timeline" style="display:inline-block;padding:10px 18px;background:#E89A3C;color:#0D0C0A;text-decoration:none;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;border-radius:6px;">Timeline</a>
    <a href="${APP_URL}/replay" style="display:inline-block;padding:10px 18px;background:rgba(232,228,221,0.06);color:rgba(232,228,221,0.7);text-decoration:none;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;border-radius:6px;border:1px solid rgba(232,228,221,0.1);">Replay a file</a>
  </div>
  <div style="margin-top:48px;padding-top:24px;border-top:1px solid rgba(232,228,221,0.06);font-family:monospace;font-size:10px;color:rgba(232,228,221,0.2);text-transform:uppercase;letter-spacing:0.08em;">
    Spine · <a href="${APP_URL}" style="color:rgba(232,228,221,0.35);text-decoration:none;">spine.xxiautomate.com</a> ·
    <a href="${APP_URL}/dashboard" style="color:rgba(232,228,221,0.35);text-decoration:none;">Manage</a>
  </div>
</div>
</body>
</html>`;
}

export async function sendEmailBriefing(data: BriefingData, dateLabel: string): Promise<boolean> {
  const result = await sendEmail({
    from: FROM_ADDRESS,
    to: data.email,
    subject: `Spine Briefing · ${dateLabel}`,
    html: buildEmailHtml(data, dateLabel),
    text: buildSlackText(data, dateLabel).replace(/[*_<>]/g, ''),
  });
  return result.ok;
}
