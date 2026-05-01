// GET /api/timeline-diff?t1=ISO&t2=ISO&entity=...&limit=20
//
// Gate C — visual proof of memory. Returns two snapshots ("what Spine
// knew on Mon" / "...on Thu") plus a diff of what changed between them.
// Powers the dashboard's `/dashboard/timeline` slider.
//
// Both snapshots are scoped to the calling user. Auth via cookie session
// (this is a dashboard endpoint, not an MCP route — bearer keys are
// rejected here so a leaked key can't enumerate the timeline).
//
// Snapshots are bounded: we return at most `limit` memories per side
// (default 20, max 50) plus the full counts. The slider UI uses the
// counts for "what changed at a glance" + the recent list for "what
// changed concretely". Anyone wanting the full corpus exports it.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase, getServerUser, isAuthConfigured } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MemoryRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  type: string | null;
  created_at: string;
  signal_tier: string | null;
};

const VALID_TYPES = ['decision', 'fact', 'bug', 'feature', 'context'] as const;
type ValidType = (typeof VALID_TYPES)[number];

function isValidType(t: unknown): t is ValidType {
  return typeof t === 'string' && (VALID_TYPES as readonly string[]).includes(t);
}

function parseTimestamp(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}

function clampLimit(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 50) return n;
  return 20;
}

export async function GET(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });
  }
  const user = await getServerUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const sb = await getServerSupabase();
  if (!sb) {
    return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  }

  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const t1 = parseTimestamp(sp.get('t1'), sevenDaysAgo);
  const t2 = parseTimestamp(sp.get('t2'), now);
  const entity = (sp.get('entity') ?? '').trim().slice(0, 200);
  const limit = clampLimit(sp.get('limit'));

  // Defensive: t1 must be < t2. If reversed, swap so the diff math
  // never goes negative. The UI defends against this too but server
  // is the last line.
  const [from, to] = t1 <= t2 ? [t1, t2] : [t2, t1];

  // ── Snapshot at T = (count of memories with created_at <= T) ─────────
  // Plus the most-recent N memories at that snapshot, plus type breakdown.
  // Three queries per snapshot is fine — the index on (user_id,
  // created_at) makes them all <10ms.
  const buildSnapshot = async (cutoff: Date) => {
    const cutoffIso = cutoff.toISOString();

    // Total count + byType: a single GROUP BY query.
    let typeQ = sb
      .from('memories')
      .select('type, count:id', { count: 'exact' })
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .lte('created_at', cutoffIso);
    if (entity) {
      // Match either the tags array (most reliable, structured) or a
      // case-insensitive content substring (fallback). Postgres-side `or`
      // joins them. Slow on huge corpuses; bounded by the time-range
      // filter above.
      typeQ = typeQ.or(`tags.cs.{${entity}},content.ilike.%${entity}%`);
    }
    const { count: totalCount } = await typeQ;

    // Per-type counts: separate small query so we don't fight pg-rest's
    // GROUP-BY surface area for `count`. Five enum values, five queries
    // in parallel — cheap.
    const byType: Record<string, number> = {};
    await Promise.all(
      VALID_TYPES.map(async (t) => {
        let q = sb
          .from('memories')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('type', t)
          .is('deleted_at', null)
          .lte('created_at', cutoffIso);
        if (entity) q = q.or(`tags.cs.{${entity}},content.ilike.%${entity}%`);
        const { count } = await q;
        byType[t] = count ?? 0;
      })
    );

    // Recent N (most recent at this cutoff). The slider's right-hand
    // panel shows "the latest things Spine knew on this day".
    let recentQ = sb
      .from('memories')
      .select('id, content, source, tags, type, created_at, signal_tier')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .lte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (entity) recentQ = recentQ.or(`tags.cs.{${entity}},content.ilike.%${entity}%`);
    const { data: recent } = await recentQ;

    return {
      cutoff: cutoffIso,
      totalCount: totalCount ?? 0,
      byType,
      recent: ((recent ?? []) as MemoryRow[]).map((r) => ({
        id: r.id,
        content: r.content,
        source: r.source,
        tags: r.tags ?? [],
        type: r.type ?? 'context',
        createdAt: r.created_at,
        signalTier: r.signal_tier,
      })),
    };
  };

  // ── Diff = memories created in (from, to] ────────────────────────────
  // Uses the half-open interval so back-to-back queries don't double-count.
  let diffQ = sb
    .from('memories')
    .select('id, content, source, tags, type, created_at, signal_tier')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .gt('created_at', from.toISOString())
    .lte('created_at', to.toISOString())
    .order('created_at', { ascending: true });
  if (entity) diffQ = diffQ.or(`tags.cs.{${entity}},content.ilike.%${entity}%`);
  const { data: diffRows } = await diffQ.limit(200);
  const diffMemories = ((diffRows ?? []) as MemoryRow[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags ?? [],
    type: r.type ?? 'context',
    createdAt: r.created_at,
    signalTier: r.signal_tier,
  }));

  const diffByType: Record<string, number> = {};
  for (const t of VALID_TYPES) diffByType[t] = 0;
  for (const m of diffMemories) {
    if (isValidType(m.type)) diffByType[m.type] += 1;
  }

  const [snapshot1, snapshot2] = await Promise.all([
    buildSnapshot(from),
    buildSnapshot(to),
  ]);

  return NextResponse.json(
    {
      from: from.toISOString(),
      to: to.toISOString(),
      entity: entity || null,
      snapshot1,
      snapshot2,
      diff: {
        added: diffMemories,
        addedCount: diffMemories.length,
        // The diff is intentionally bounded at 200 rows; if the response
        // hit that ceiling the actual count is higher.
        truncated: diffMemories.length === 200,
        byType: diffByType,
        // Decisions are surfaced separately because they're the
        // demo-headline event ("what did we DECIDE this week?").
        decisions: diffMemories.filter((m) => m.type === 'decision'),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
