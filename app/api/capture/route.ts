import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireApiKey } from '@/lib/auth';
import { embedMany } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { captureCap, isUnlimited, PLAN_LIMITS } from '@/lib/plan-limits';
import { assignCluster } from '@/lib/clusters';
import { scanDuplicatesForMemory } from '@/lib/hygiene';
import { extractAndIndex } from '@/lib/entity-extractor';
import { detectConflicts } from '@/lib/conflict-detector';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

const VALID_TYPES = new Set(['decision', 'bug', 'feature', 'context', 'fact']);

type CaptureItem = {
  content?: unknown;
  source?: unknown;
  tags?: unknown;
  type?: unknown;
};

type Body = CaptureItem & { bulk?: CaptureItem[] };

function coerceItem(item: CaptureItem): { content: string; source: string | null; tags: string[] | null; type: string } | null {
  if (typeof item.content !== 'string' || !item.content.trim()) return null;
  return {
    content: item.content,
    source: typeof item.source === 'string' ? item.source : null,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string')
      : null,
    type: typeof item.type === 'string' && VALID_TYPES.has(item.type) ? item.type : 'context',
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }));
  }

  const rawItems: CaptureItem[] = Array.isArray(body.bulk) ? body.bulk : [body];
  const items = rawItems.map(coerceItem);
  if (items.some((x) => x === null) || items.length === 0) {
    return withCors(
      NextResponse.json(
        { error: 'Each memory must include a non-empty content string.' },
        { status: 400 }
      )
    );
  }
  const clean = items as NonNullable<(typeof items)[number]>[];

  let vectors: number[][];
  try {
    vectors = await embedMany(clean.map((c) => c.content));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }

  const supabase = getSupabase();
  if (!supabase)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  // Plan cap: count live memories for this user, reject if inserting this
  // batch would exceed the configured cap. Power plan bypasses entirely.
  if (!isUnlimited(auth.authed.plan)) {
    const { count, error: countErr } = await supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId)
      .is('deleted_at', null);
    if (countErr) {
      return withCors(NextResponse.json({ error: countErr.message }, { status: 500 }));
    }
    const current = count ?? 0;
    const limit = captureCap(auth.authed.plan);
    if (current + clean.length > limit) {
      return withCors(
        NextResponse.json(
          {
            error: `Plan cap reached: ${PLAN_LIMITS[auth.authed.plan].name} allows ${limit} memories. Upgrade to add more.`,
            error_code: 'plan_upgrade_required',
            plan: auth.authed.plan,
            count: current,
            limit,
            attempted: clean.length,
          },
          { status: 402 }
        )
      );
    }
  }

  // Auto-tag via cluster assignment before insert so the cluster_id + cluster
  // tag land in the same row. Sequential per item (clusters mutate across
  // items in the same batch — two very similar turns should land in the
  // same new cluster, not two fresh ones).
  const augmented: Array<{
    user_id: string;
    org_id: string | null;
    content: string;
    source: string | null;
    tags: string[] | null;
    type: string;
    embedding: number[];
    cluster_id: string | null;
  }> = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const assignment = await assignCluster(
      supabase,
      auth.authed.userId,
      vectors[i],
      c.content
    );
    const baseTags = c.tags ?? [];
    const tags = assignment && !baseTags.includes(assignment.label)
      ? [...baseTags, assignment.label]
      : baseTags;
    augmented.push({
      user_id: auth.authed.userId,
      org_id: auth.authed.orgId ?? null,
      content: c.content,
      source: c.source,
      tags: tags.length > 0 ? tags : null,
      type: c.type,
      embedding: vectors[i],
      cluster_id: assignment?.clusterId ?? null,
    });
  }

  const { data, error } = await supabase.from('memories').insert(augmented).select('id');
  if (error) {
    return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }
  const ids = (data ?? []).map((r) => r.id as string);

  // Fire-and-forget dedupe scan for each new memory. Seeds memory_duplicates
  // proactively so the hygiene dashboard shows a pair the moment it's
  // created — no nightly cron required. Failures are swallowed inside
  // scanDuplicatesForMemory; we do not await the chain.
  for (const newId of ids) {
    void scanDuplicatesForMemory(supabase, auth.authed.userId, newId);
  }

  // Fire-and-forget entity extraction + conflict detection for each new memory.
  for (let i = 0; i < ids.length; i++) {
    const content = augmented[i]?.content;
    if (content) {
      void extractAndIndex(supabase, auth.authed.userId, ids[i], content).catch(() => void 0);
      void detectConflicts(supabase, auth.authed.userId, ids[i], content).catch(() => void 0);
    }
  }

  // Invalidate cached hygiene summaries so the next /api/hygiene/summary
  // hit (from the extension or spine_hygiene tool) returns fresh counts.
  // Global tag — acceptable because the underlying query is four cheap
  // head counts per user and a capture is a rare event.
  revalidateTag('hygiene');

  return withCors(
    NextResponse.json(Array.isArray(body.bulk) ? { ids } : { id: ids[0] })
  );
}
