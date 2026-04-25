// Weekly retention email — sent Monday 8am customer-local time.
// Surfaces: captures this week, conflicts resolved, memory-age histogram,
// stale-memory alert with one-click revive. Drives re-engagement + churn signal.

import { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, FROM_ADDRESS, wrapEmail } from './resend';
import { DECAY_DAYS } from './decay';

// ── Data gathering ─────────────────────────────────────────────────────────────

interface RetentionData {
  userId: string;
  email: string;
  totalMemories: number;
  capturedThisWeek: number;
  conflictsResolvedThisWeek: number;
  unresolvedConflicts: number;
  staleCount: number;            // approaching decay
  archivedCount: number;         // already soft-archived
  ageHistogram: { label: string; count: number }[];
  topEntities: { name: string; type: string; count: number }[];
  oldestActive: { id: string; content: string; daysAgo: number } | null;
}

export async function gatherRetentionData(
  sb: SupabaseClient,
  userId: string,
  userEmail: string
): Promise<RetentionData> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(now.getTime() - (DECAY_DAYS - 14) * 24 * 60 * 60 * 1000); // 14 days before decay

  const [
    totalRes,
    weekRes,
    conflictResolvedRes,
    unresolvedRes,
    staleRes,
    archivedRes,
    entitiesRes,
    oldestRes,
  ] = await Promise.all([
    // Total live memories
    sb.from('memories').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('deleted_at', null).is('archived_at', null),

    // Captured this week
    sb.from('memories').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('deleted_at', null)
      .gte('created_at', weekAgo.toISOString()),

    // Conflicts resolved this week
    sb.from('memory_conflicts').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('resolution', 'is', null)
      .gte('resolved_at', weekAgo.toISOString()),

    // Unresolved conflicts
    sb.from('memory_conflicts').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('resolution', null),

    // Approaching decay (last_accessed_at older than staleThreshold, not yet archived)
    sb.from('memories').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('deleted_at', null).is('archived_at', null)
      .lt('last_accessed_at', staleThreshold.toISOString()),

    // Already archived
    sb.from('memories').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('deleted_at', null)
      .not('archived_at', 'is', null),

    // Top entities
    sb.from('entity_nodes').select('name, type, mention_count')
      .eq('user_id', userId)
      .order('mention_count', { ascending: false })
      .limit(5),

    // Oldest active memory
    sb.from('memories').select('id, content, created_at')
      .eq('user_id', userId).is('deleted_at', null).is('archived_at', null)
      .order('created_at', { ascending: true })
      .limit(1),
  ]);

  // ── Age histogram ──────────────────────────────────────────────────────────
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
      const q = sb.from('memories').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).is('deleted_at', null).is('archived_at', null)
        .lt('created_at', prev.toISOString())
        .gte('created_at', curr.toISOString());
      const { count } = await q;
      return { label: b.label, count: count ?? 0 };
    })
  );

  // ── Oldest memory ──────────────────────────────────────────────────────────
  const oldestRow = oldestRes.data?.[0];
  const oldestActive = oldestRow
    ? {
        id: oldestRow.id as string,
        content: (oldestRow.content as string).slice(0, 120),
        daysAgo: Math.round((now.getTime() - new Date(oldestRow.created_at as string).getTime()) / 86400000),
      }
    : null;

  return {
    userId,
    email: userEmail,
    totalMemories: totalRes.count ?? 0,
    capturedThisWeek: weekRes.count ?? 0,
    conflictsResolvedThisWeek: conflictResolvedRes.count ?? 0,
    unresolvedConflicts: unresolvedRes.count ?? 0,
    staleCount: staleRes.count ?? 0,
    archivedCount: archivedRes.count ?? 0,
    ageHistogram: histogramCounts,
    topEntities: ((entitiesRes.data ?? []) as { name: string; type: string; mention_count: number }[]).map((e) => ({
      name: e.name,
      type: e.type,
      count: e.mention_count,
    })),
    oldestActive,
  };
}

// ── Email renderer ─────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  person: '👤',
  project: '📦',
  tool: '🔧',
  concept: '💡',
  decision: '⚡',
};

function histogramBar(count: number, max: number): string {
  if (max === 0) return '';
  const pct = Math.round((count / max) * 100);
  const blocks = Math.round(pct / 10); // 0–10 blocks
  return '█'.repeat(blocks) + '░'.repeat(10 - blocks);
}

export function buildRetentionEmail(data: RetentionData): string {
  const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';
  const maxCount = Math.max(...data.ageHistogram.map((b) => b.count), 1);

  const dateStr = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const captureVerb = data.capturedThisWeek === 0
    ? 'Nothing captured this week.'
    : data.capturedThisWeek === 1
    ? '1 new memory'
    : `${data.capturedThisWeek} new memories`;

  const histogramHtml = data.ageHistogram
    .filter((b) => b.count > 0)
    .map(
      (b) => `
      <tr>
        <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.35);padding-right:14px;white-space:nowrap;">${b.label}</td>
        <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,154,60,0.65);">${histogramBar(b.count, maxCount)}</td>
        <td style="font-family:'Courier New',monospace;font-size:11px;color:rgba(232,228,221,0.35);padding-left:10px;">${b.count}</td>
      </tr>`
    )
    .join('');

  const entitiesHtml = data.topEntities.length > 0
    ? data.topEntities
        .map(
          (e) =>
            `<span style="display:inline-block;margin-right:8px;margin-bottom:6px;padding:3px 10px;background:rgba(232,228,221,0.04);border:1px solid rgba(232,228,221,0.08);border-radius:20px;font-size:12px;color:rgba(232,228,221,0.6);">${TYPE_ICONS[e.type] ?? '·'} ${e.name} <span style="color:rgba(232,228,221,0.3);font-size:10px;">${e.count}×</span></span>`
        )
        .join('')
    : '<p style="color:rgba(232,228,221,0.3);font-size:13px;">No entities extracted yet — use Claude Code for a few sessions.</p>';

  const staleSection =
    data.staleCount > 0
      ? `
    <div class="section-label">⚠ Memories approaching decay</div>
    <div class="nag">
      <p>${data.staleCount} ${data.staleCount === 1 ? 'memory is' : 'memories are'} approaching the ${DECAY_DAYS}-day decay threshold and will be soft-archived soon.
      These are memories you haven't accessed in over ${DECAY_DAYS - 14} days.</p>
      <p style="margin-top:8px;">
        <a href="${BASE}/timeline?filter=stale" style="color:#E89A3C;text-decoration:none;font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid rgba(232,154,60,0.3);">Review stale memories →</a>
      </p>
    </div>`
      : '';

  const conflictSection =
    data.unresolvedConflicts > 0
      ? `
    <div class="section-label">⚡ Unresolved conflicts</div>
    <div class="nag">
      <p>${data.unresolvedConflicts} ${data.unresolvedConflicts === 1 ? 'conflict needs' : 'conflicts need'} your attention — contradictions between prior and new captures.</p>
      <p style="margin-top:8px;">
        <a href="${BASE}/timeline?conflicts=1" style="color:#E89A3C;text-decoration:none;font-family:'Courier New',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid rgba(232,154,60,0.3);">Resolve conflicts →</a>
      </p>
    </div>`
      : '';

  const oldestSection = data.oldestActive
    ? `
    <div class="section-label">Oldest active memory (${data.oldestActive.daysAgo} days ago)</div>
    <div class="card">
      <div class="quote"><p>${data.oldestActive.content}${data.oldestActive.content.length >= 120 ? '…' : ''}</p></div>
    </div>`
    : '';

  const body = `
    <h1>${captureVerb}${data.capturedThisWeek > 0 ? ` — ${data.totalMemories.toLocaleString()} total` : '.'}</h1>
    <p class="sub">${dateStr} · Weekly archive digest</p>

    <div class="section-label">This week</div>
    <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
      <tr>
        <td style="padding:8px 16px 8px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
          <span style="font-size:22px;font-family:Georgia,serif;color:#E8E4DD;">${data.capturedThisWeek}</span>
          <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">captured</span>
        </td>
        <td style="padding:8px 16px 8px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
          <span style="font-size:22px;font-family:Georgia,serif;color:#E8E4DD;">${data.conflictsResolvedThisWeek}</span>
          <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">conflicts resolved</span>
        </td>
        <td style="padding:8px 0 8px 0;border-bottom:1px solid rgba(232,228,221,0.06);">
          <span style="font-size:22px;font-family:Georgia,serif;color:#E8E4DD;">${data.totalMemories.toLocaleString()}</span>
          <span style="display:block;font-family:'Courier New',monospace;font-size:10px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.08em;">total memories</span>
        </td>
      </tr>
    </table>

    ${staleSection}
    ${conflictSection}

    <div class="section-label">Memory age</div>
    <div class="card">
      <table style="border-collapse:collapse;font-family:'Courier New',monospace;">
        ${histogramHtml || '<tr><td style="color:rgba(232,228,221,0.3);font-size:12px;">No memories yet.</td></tr>'}
      </table>
    </div>

    <div class="section-label">Most referenced entities</div>
    <div class="card">
      ${entitiesHtml}
    </div>

    ${oldestSection}

    ${data.archivedCount > 0 ? `<p style="margin-top:16px;font-size:12px;color:rgba(232,228,221,0.3);font-family:'Courier New',monospace;">${data.archivedCount} memories archived (soft) · <a href="${BASE}/timeline?filter=archived" style="color:rgba(232,154,60,0.5);">Revive any time</a></p>` : ''}

    <a href="${BASE}/timeline" class="cta" style="margin-top:32px;display:inline-block;">Open your archive →</a>
  `;

  return wrapEmail(`Your Spine archive · ${dateStr}`, body);
}

// ── Job runner ─────────────────────────────────────────────────────────────────

export interface RetentionJobResult {
  sent: number;
  skipped: number;
  errors: number;
}

export async function runWeeklyRetentionJob(sb: SupabaseClient): Promise<RetentionJobResult> {
  // Find active users: had a memory in the last 90 days OR signed up in the last 30 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeUsers } = await sb
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .gte('created_at', ninetyDaysAgo);

  if (!activeUsers || activeUsers.length === 0) return { sent: 0, skipped: 0, errors: 0 };

  const userIds = [...new Set((activeUsers as { user_id: string }[]).map((r) => r.user_id))];

  let sent = 0, skipped = 0, errors = 0;

  for (const userId of userIds) {
    try {
      // Get email from auth
      const { data: authUser } = await sb.auth.admin.getUserById(userId);
      const email = authUser?.user?.email;
      if (!email) { skipped++; continue; }

      const retData = await gatherRetentionData(sb, userId, email);

      // Skip users with zero activity (nothing to show)
      if (retData.totalMemories === 0) { skipped++; continue; }

      const html = buildRetentionEmail(retData);
      const result = await sendEmail({
        from: FROM_ADDRESS,
        to: email,
        subject: `Your Spine archive — ${retData.capturedThisWeek} captured this week`,
        html,
        text: `Spine weekly: ${retData.capturedThisWeek} captured, ${retData.totalMemories} total, ${retData.unresolvedConflicts} conflicts unresolved.`,
      });

      if (result.ok) sent++;
      else errors++;

      // Rate limit: 350ms between sends
      await new Promise((r) => setTimeout(r, 350));
    } catch {
      errors++;
    }
  }

  return { sent, skipped, errors };
}
