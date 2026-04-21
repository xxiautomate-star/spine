// Weekly inbox: every Sunday ~6pm local (run as UTC cron, close enough),
// email each active user a summary of the past 7 days.
//
// Contents:
//   - Total memories captured (by source breakdown)
//   - Top 3 recurring topics (from entity graph, by mention_count)
//   - Topics asked 2+ times without implementation (nag list)
//   - CTA: Power plan for team sharing + API export
//
// No extra Haiku call — data is derived from the Postgres tables directly,
// keeping this cheap (free even without LLM).

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, wrapEmail, FROM_ADDRESS } from './resend';

// ── Types ─────────────────────────────────────────────────────────────────

type WeeklySummary = {
  userId: string;
  email: string;
  plan: string;
  totalMemories: number;
  bySource: Array<{ source: string; count: number }>;
  topEntities: Array<{ name: string; type: string; count: number }>;
  weeklyNags: Array<{ topic: string; occurrences: number }>;
  digestCount: number;
  resolvedQuestions: number;
};

// ── Data gathering ─────────────────────────────────────────────────────────

async function gatherWeeklyData(
  sb: SupabaseClient,
  userId: string,
  email: string,
  plan: string,
  windowStart: string,
  windowEnd: string
): Promise<WeeklySummary> {
  // Total memories in window.
  const { count: totalMemories } = await sb
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd);

  // Memories by source.
  const { data: memRows } = await sb
    .from('memories')
    .select('source')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd)
    .limit(1000);

  const sourceMap = new Map<string, number>();
  for (const row of (memRows ?? []) as { source: string | null }[]) {
    const key = row.source ?? 'unknown';
    sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
  }
  const bySource = [...sourceMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));

  // Top entities by mention count (last 7 days weight = last_seen in window).
  const { data: entityRows } = await sb
    .from('entity_nodes')
    .select('name, type, mention_count')
    .eq('user_id', userId)
    .gte('last_seen', windowStart)
    .order('mention_count', { ascending: false })
    .limit(5);

  const topEntities = ((entityRows ?? []) as { name: string; type: string; mention_count: number }[])
    .map((e) => ({ name: e.name, type: e.type, count: e.mention_count }));

  // Nags from digests in the window.
  const { data: digestRows } = await sb
    .from('digests')
    .select('nags')
    .eq('user_id', userId)
    .gte('date', windowStart.slice(0, 10))
    .lte('date', windowEnd.slice(0, 10));

  const nagMap = new Map<string, number>();
  for (const d of (digestRows ?? []) as { nags: unknown[] }[]) {
    for (const nag of d.nags ?? []) {
      if (nag && typeof (nag as { topic?: string }).topic === 'string') {
        const topic = (nag as { topic: string }).topic;
        nagMap.set(topic, (nagMap.get(topic) ?? 0) + 1);
      }
    }
  }
  const weeklyNags = [...nagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, occurrences]) => ({ topic, occurrences }));

  // How many digests were generated and how many questions resolved.
  const { count: digestCount } = await sb
    .from('digests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('date', windowStart.slice(0, 10))
    .lte('date', windowEnd.slice(0, 10));

  const digestIds = ((digestRows ?? []) as { id?: string }[]).map((d) => d.id).filter(Boolean);
  let resolvedQuestions = 0;
  if (digestIds.length > 0) {
    const { count: rCount } = await sb
      .from('digest_resolutions')
      .select('id', { count: 'exact', head: true })
      .in('digest_id', digestIds as string[])
      .eq('item_type', 'question');
    resolvedQuestions = rCount ?? 0;
  }

  return {
    userId,
    email,
    plan,
    totalMemories: totalMemories ?? 0,
    bySource,
    topEntities,
    weeklyNags,
    digestCount: digestCount ?? 0,
    resolvedQuestions,
  };
}

// ── Email rendering ────────────────────────────────────────────────────────

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    'claude.ai': 'Claude',
    'chatgpt.com': 'ChatGPT',
    'gemini.google.com': 'Gemini',
    'v0.dev': 'v0',
    'cursor.sh': 'Cursor',
    'codeium.com': 'Codeium',
    'unknown': 'Unknown',
  };
  return map[source] ?? source;
}

function entityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    person: '👤', project: '📦', tool: '🔧', concept: '💡', decision: '✓',
  };
  return map[type] ?? '·';
}

function renderWeeklyEmail(
  summary: WeeklySummary,
  weekStart: string,
  weekEnd: string,
  dashboardUrl: string
): string {
  const sourcesHtml = summary.bySource.length > 0
    ? summary.bySource
        .map((s) => `<span style="display:inline-block;margin-right:16px;font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.55);">
            <strong style="color:#E89A3C;">${s.count}</strong> ${sourceLabel(s.source)}
          </span>`)
        .join('')
    : '<span style="color:rgba(232,228,221,0.3);font-size:13px;">No sources detected</span>';

  const entitiesHtml = summary.topEntities.length > 0
    ? `<div class="card">
        ${summary.topEntities.map((e) => `<p style="margin:0 0 6px;font-size:14px;color:rgba(232,228,221,0.75);">
            <span style="font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);margin-right:8px;">${entityTypeLabel(e.type)}</span>
            ${e.name}
            <span style="font-family:'Courier New',monospace;font-size:9px;color:rgba(232,154,60,0.5);margin-left:6px;">×${e.count}</span>
          </p>`).join('')}
      </div>`
    : '';

  const nagsHtml = summary.weeklyNags.length > 0
    ? `<p class="section-label">↺ Still unresolved</p>
      ${summary.weeklyNags.map((n) => `<div class="nag">
        <p>You mentioned <strong>${n.topic}</strong> ${n.occurrences} ${n.occurrences === 1 ? 'time' : 'times'} this week without closing it.</p>
      </div>`).join('')}`
    : '';

  const powerCta = summary.plan !== 'power'
    ? `<div style="margin-top:24px;padding:20px;border:1px solid rgba(232,154,60,0.2);border-radius:8px;background:rgba(232,154,60,0.04);">
        <p style="margin:0 0 6px;font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(232,154,60,0.6);">Power plan</p>
        <p style="margin:0 0 12px;font-size:14px;color:rgba(232,228,221,0.7);">Share your archive with teammates. Export via API. Unlimited memories.</p>
        <a href="${dashboardUrl}/pricing" style="font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#E89A3C;text-decoration:none;border-bottom:1px solid rgba(232,154,60,0.4);padding-bottom:1px;">Upgrade →</a>
      </div>`
    : '';

  const body = `
  <h1>Your week in memory.</h1>
  <p class="sub">${weekStart} – ${weekEnd}</p>

  <div style="margin-bottom:24px;">
    <p style="font-family:'Courier New',monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:rgba(232,154,60,0.6);margin-bottom:12px;">§ This week</p>
    <p style="font-size:36px;font-family:Georgia,serif;color:#E8E4DD;margin:0 0 4px;">
      ${summary.totalMemories}
      <span style="font-size:16px;color:rgba(232,228,221,0.4);">memories</span>
    </p>
    <p style="margin:0;font-size:13px;color:rgba(232,228,221,0.35);">${summary.digestCount} daily ${summary.digestCount === 1 ? 'digest' : 'digests'} · ${summary.resolvedQuestions} questions resolved</p>
  </div>

  <p class="section-label">§ By source</p>
  <div style="margin-bottom:24px;">${sourcesHtml}</div>

  ${summary.topEntities.length > 0 ? `<p class="section-label">§ Recurring this week</p>${entitiesHtml}` : ''}
  ${nagsHtml}
  ${powerCta}

  <a href="${dashboardUrl}/timeline" class="cta">Open your archive →</a>`;

  return wrapEmail('Your Spine weekly summary', body);
}

// ── Run job ────────────────────────────────────────────────────────────────

/**
 * Run the weekly inbox job. Finds all users active in the past 7 days,
 * generates a summary email, and sends via Resend.
 * Called from /api/cron/weekly-inbox (Sunday ~6pm UTC).
 */
export async function runWeeklyInboxJob(
  sb: SupabaseClient
): Promise<{ sent: number; skipped: number; errors: number }> {
  const now = new Date();
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';

  // Find users active in the window.
  const { data: memoryUsers } = await sb
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd)
    .limit(2000);

  if (!memoryUsers || memoryUsers.length === 0) return { sent: 0, skipped: 0, errors: 0 };

  const uniqueIds = [...new Set((memoryUsers as { user_id: string }[]).map((r) => r.user_id))];

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  const weekStart = windowStart.slice(0, 10);
  const weekEnd = windowEnd.slice(0, 10);

  for (const uid of uniqueIds) {
    try {
      const { data: profile } = await sb
        .from('profiles')
        .select('plan')
        .eq('user_id', uid)
        .maybeSingle();

      const { data: authUser } = await sb.auth.admin.getUserById(uid);
      const email = authUser?.user?.email ?? null;

      if (!email) { skipped++; continue; }

      const summary = await gatherWeeklyData(
        sb, uid, email, (profile?.plan as string) ?? 'free', windowStart, windowEnd
      );

      if (summary.totalMemories === 0) { skipped++; continue; }

      const html = renderWeeklyEmail(summary, weekStart, weekEnd, dashboardUrl);
      const result = await sendEmail({
        from: FROM_ADDRESS,
        to: email,
        subject: `Your Spine week — ${weekStart}`,
        html,
        text: `This week you captured ${summary.totalMemories} memories across ${summary.bySource.length} AI tools. Open your archive: ${dashboardUrl}/timeline`,
      });

      if (result.ok) {
        sent++;
      } else {
        errors++;
        console.error('[spine/weekly-inbox] send failed', uid, result.error);
      }
    } catch (err) {
      errors++;
      console.error('[spine/weekly-inbox] user error', uid, err);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return { sent, skipped, errors };
}
