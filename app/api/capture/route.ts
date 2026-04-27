import { NextResponse, type NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { requireApiKey } from '@/lib/auth';
import { embedManyWithMeta } from '@/lib/embeddings';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { captureCap, isUnlimited, PLAN_LIMITS } from '@/lib/plan-limits';
import { assignCluster } from '@/lib/clusters';
import { scanDuplicatesForMemory } from '@/lib/hygiene';
import { extractAndIndex } from '@/lib/entity-extractor';
import { detectConflicts } from '@/lib/conflict-detector';
import { logAuditBatchFireForget, type AuditEntry } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

const VALID_TYPES = new Set(['decision', 'bug', 'feature', 'context', 'fact']);

// Liberal mime check: accept any string that looks like a/b. Real validation
// happens at the storage layer; we don't gatekeep what users archive.
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

type CaptureItem = {
  content?: unknown;
  source?: unknown;
  tags?: unknown;
  type?: unknown;
  // v2 multi-modal
  mime?: unknown;
  content_url?: unknown;
  content_size?: unknown;
  caption?: unknown;
};

type Body = CaptureItem & { bulk?: CaptureItem[] };

type CleanItem = {
  content: string;
  source: string | null;
  tags: string[] | null;
  type: string;
  mime: string;
  contentUrl: string | null;
  contentSize: number | null;
  caption: string | null;
  // The string that gets embedded. Either content (text) or caption (non-text).
  embedText: string;
};

function coerceItem(item: CaptureItem): CleanItem | null {
  if (typeof item.content !== 'string' || !item.content.trim()) return null;

  const rawMime = typeof item.mime === 'string' ? item.mime.trim() : 'text/plain';
  const mime = MIME_RE.test(rawMime) ? rawMime : 'text/plain';

  const contentUrl = typeof item.content_url === 'string' && item.content_url.trim()
    ? item.content_url.trim()
    : null;

  const contentSize = typeof item.content_size === 'number' && Number.isFinite(item.content_size) && item.content_size >= 0
    ? Math.floor(item.content_size)
    : null;

  const caption = typeof item.caption === 'string' && item.caption.trim()
    ? item.caption.trim()
    : null;

  // For non-text rows we MUST embed something textual. Prefer caption, fall
  // back to the content text (which the caller put there as a description).
  const isText = mime === 'text/plain' || mime.startsWith('text/');
  const embedText = isText ? item.content : (caption ?? item.content);

  return {
    content: item.content,
    source: typeof item.source === 'string' ? item.source : null,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string')
      : null,
    type: typeof item.type === 'string' && VALID_TYPES.has(item.type) ? item.type : 'context',
    mime,
    contentUrl,
    contentSize,
    caption,
    embedText,
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
  const clean = items as CleanItem[];

  let embedResult;
  try {
    embedResult = await embedManyWithMeta(clean.map((c) => c.embedText));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }
  const { vectors, provider: embedProvider, model: embedModel, dims: embedDims } = embedResult;

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
    mime: string;
    content_url: string | null;
    content_size: number | null;
    caption: string | null;
    embed_provider: string;
    embed_model: string;
    embed_dims: number;
  }> = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const assignment = await assignCluster(
      supabase,
      auth.authed.userId,
      vectors[i],
      c.embedText
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
      mime: c.mime,
      content_url: c.contentUrl,
      content_size: c.contentSize,
      caption: c.caption,
      embed_provider: embedProvider,
      embed_model: embedModel,
      embed_dims: embedDims,
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

  // Fire-and-forget entity extraction + conflict detection. Skip non-text
  // captures: the entity extractor only knows how to parse text, and a JPEG's
  // caption is too thin a signal to seed the entity graph.
  for (let i = 0; i < ids.length; i++) {
    const item = augmented[i];
    if (item.mime === 'text/plain') {
      void extractAndIndex(supabase, auth.authed.userId, ids[i], item.content).catch(() => void 0);
      void detectConflicts(supabase, auth.authed.userId, ids[i], item.content).catch(() => void 0);
    }
  }

  // Audit: one row per captured memory + one row per embed call (a single
  // bulk capture is one OpenAI roundtrip but produces N rows of provenance).
  const auditRows: AuditEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    auditRows.push({
      userId: auth.authed.userId,
      orgId: auth.authed.orgId ?? null,
      op: 'write',
      memoryId: ids[i],
      caller: auth.authed.keyId,
      mime: augmented[i].mime,
      embedProvider,
      metadata: {
        source: augmented[i].source,
        type: augmented[i].type,
        has_url: augmented[i].content_url !== null,
        embed_model: embedModel,
      },
    });
  }
  // One embed audit row covering the batch. Memory_id null → row-level reembeds
  // (a different op) cite specific ids, but the initial write embed is
  // shared across the batch.
  auditRows.push({
    userId: auth.authed.userId,
    orgId: auth.authed.orgId ?? null,
    op: 'embed',
    caller: auth.authed.keyId,
    embedProvider,
    metadata: { batch_size: ids.length, embed_model: embedModel },
  });
  logAuditBatchFireForget(auditRows);

  // Invalidate cached hygiene summaries so the next /api/hygiene/summary
  // hit (from the extension or spine_hygiene tool) returns fresh counts.
  // Global tag — acceptable because the underlying query is four cheap
  // head counts per user and a capture is a rare event.
  revalidateTag('hygiene');

  return withCors(
    NextResponse.json(
      Array.isArray(body.bulk)
        ? { ids, embed_provider: embedProvider, embed_model: embedModel }
        : { id: ids[0], embed_provider: embedProvider, embed_model: embedModel }
    )
  );
}
