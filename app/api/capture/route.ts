import { NextResponse, type NextRequest } from 'next/server';
// revalidateTag/expireTag signature changed in Next 16 — temporarily skip
// the on-demand purge. /api/hygiene/summary will see slightly stale counts
// (refreshed on its own revalidate window) until we wire the new API.
import { requireApiKeyWithScope, logKeyReceipt } from '@/lib/auth';
import { embedManyWithMeta } from '@/lib/embeddings';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { captureCap, isUnlimited, buildPlanCapError } from '@/lib/plan-limits';
import { assignCluster } from '@/lib/clusters';
import { scanDuplicatesForMemory } from '@/lib/hygiene';
import { extractAndIndex } from '@/lib/entity-extractor';
import { detectConflicts } from '@/lib/conflict-detector';
import { extractDecision } from '@/lib/decision-extractor';
import { logAuditBatchFireForget, type AuditEntry } from '@/lib/audit';
import { scoreSignals, type SignalScore, type SignalTier, fallbackScore } from '@/lib/signal-scorer';

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
  // v2.1 conversation capture (brief 021)
  session_id?: unknown;
  kind?: unknown;            // 'turn' | 'digest'
  tool_name?: unknown;
  files_touched?: unknown;
  embed_turns?: unknown;     // power-user opt-in: embed turn rows too (default false)
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
  sessionId: string | null;
  kind: 'turn' | 'digest' | null;
  toolName: string | null;
  filesTouched: string[] | null;
  // The string that gets embedded. Either content (text) or caption (non-text).
  embedText: string;
  // True = skip the OpenAI embed call for this item (always for turn rows
  // unless embed_turns=true). Digests + non-conversation rows always embed.
  skipEmbed: boolean;
  // Pre-scorer override (brief 023). When set, the signal-quality scorer is
  // skipped and this score is used directly. Null → run the scorer.
  preOverrideScore: SignalScore | null;
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

  const rawSessionId =
    typeof item.session_id === 'string' && item.session_id.trim() ? item.session_id.trim() : null;
  // Cap session_id at 200 chars — arbitrary but generous (UUID + suffix) and
  // prevents pathological inputs from blowing up the index.
  const sessionId = rawSessionId && rawSessionId.length <= 200 ? rawSessionId : null;

  const kind: 'turn' | 'digest' | null =
    item.kind === 'turn' || item.kind === 'digest' ? item.kind : null;

  const rawToolName =
    typeof item.tool_name === 'string' && item.tool_name.trim() ? item.tool_name.trim() : null;
  const toolName = rawToolName && rawToolName.length <= 100 ? rawToolName : null;

  // Files-touched: cap each path at 1000 chars and the array at 50 entries.
  const filesTouched = Array.isArray(item.files_touched)
    ? item.files_touched
        .filter((f): f is string => typeof f === 'string' && f.length > 0 && f.length <= 1000)
        .slice(0, 50)
    : null;

  // For non-text rows we MUST embed something textual. Prefer caption, fall
  // back to the content text (which the caller put there as a description).
  const isText = mime === 'text/plain' || mime.startsWith('text/');
  const embedText = isText ? item.content : (caption ?? item.content);

  // Embedding policy: turns skip embedding by default to keep OpenAI spend
  // bounded on chatty users. Digests always embed (low volume, high signal).
  // Non-conversation rows (kind=null) embed as before.
  const embedTurnsOptIn = item.embed_turns === true;
  const skipEmbed = kind === 'turn' && !embedTurnsOptIn;

  // Brief 023 — pre-scorer override:
  //   - turn (no embed_turns) → tier='low' regardless of content
  //   - digest → tier='high' (intentional artifact)
  //   - non-text mime → tier='standard' (we don't Haiku-score images)
  // Anything else falls through to the scorer.
  let preOverrideScore: SignalScore | null = null;
  if (kind === 'turn' && !embedTurnsOptIn) {
    preOverrideScore = { score: 0.0, tier: 'low', reason: 'conversation turn (chatter by default)' };
  } else if (kind === 'digest') {
    preOverrideScore = { score: 1.0, tier: 'high', reason: 'session digest — intentional artifact' };
  } else if (!isText) {
    preOverrideScore = { score: 0.5, tier: 'standard', reason: 'non-text mime (' + mime + ')' };
  }

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
    sessionId,
    kind,
    toolName,
    filesTouched: filesTouched && filesTouched.length > 0 ? filesTouched : null,
    embedText,
    skipEmbed,
    preOverrideScore,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKeyWithScope(req, 'write');
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));
  // Receipt: fire-and-forget. See /api/recall for the same pattern + rationale.
  logKeyReceipt({
    keyId: auth.authed.keyId,
    userId: auth.authed.userId,
    route: '/api/capture',
    scopeRequired: 'write',
    statusCode: 200,
  });

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

  // Embed targets: items not pre-overridden to skip embed (i.e. not turns).
  // The scorer can later flag standard-track items as 'low' — those embeds
  // get discarded post-score (~2-5% waste rate, acceptable to keep latency
  // = max(scorer, embed) instead of sum).
  const embedTargets: { idx: number; text: string }[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (!clean[i].skipEmbed) embedTargets.push({ idx: i, text: clean[i].embedText });
  }

  // Scorer targets: items WITHOUT a pre-override. The scorer decides their
  // tier; pre-overridden items skip the Haiku call entirely.
  const scoreTargets: { idx: number; text: string }[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (!clean[i].preOverrideScore) scoreTargets.push({ idx: i, text: clean[i].embedText });
  }

  // Run scorer + embed in parallel — total latency = max(scorer, embed),
  // not sum. Embed failures abort the request; scorer failures fall back
  // to 'standard' per item (never blocks a write).
  let embedProvider = '';
  let embedModel = '';
  let embedDims = 0;
  const vectorByIdx = new Map<number, number[]>();
  const scoreByIdx = new Map<number, SignalScore>();

  // Seed pre-override scores into the result map immediately.
  for (let i = 0; i < clean.length; i++) {
    const pre = clean[i].preOverrideScore;
    if (pre) scoreByIdx.set(i, pre);
  }

  try {
    const [embedResult, scoredArr] = await Promise.all([
      embedTargets.length > 0
        ? embedManyWithMeta(embedTargets.map((t) => t.text))
        : Promise.resolve(null),
      scoreTargets.length > 0
        ? scoreSignals(scoreTargets.map((t) => t.text))
        : Promise.resolve([] as SignalScore[]),
    ]);

    if (embedResult) {
      embedProvider = embedResult.provider;
      embedModel = embedResult.model;
      embedDims = embedResult.dims;
      embedTargets.forEach((t, j) => vectorByIdx.set(t.idx, embedResult.vectors[j]));
    }

    // Defensive: scorer should always return scoreTargets.length items. If
    // it returns fewer (truncated JSON, etc.), per-item fallback.
    scoreTargets.forEach((t, j) => {
      const s = scoredArr[j];
      scoreByIdx.set(t.idx, s ?? fallbackScore('scorer returned fewer items than requested'));
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }

  // Finalize: if a scored (non-overridden) item came back as 'low', discard
  // its precomputed embedding so the row stores embedding=null. The
  // OpenAI roundtrip is wasted but the corpus stays clean.
  for (let i = 0; i < clean.length; i++) {
    const score = scoreByIdx.get(i);
    if (score && score.tier === 'low') vectorByIdx.delete(i);
  }

  const supabase = getSupabase();
  if (!supabase)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  // Plan cap: count live memories for this user, EXCLUDING low-signal rows
  // (filtered noise doesn't count toward the user's quota — that's brief 023's
  // promise). Reject if inserting this batch's high+standard items would
  // exceed the cap. Power plan bypasses entirely.
  if (!isUnlimited(auth.authed.plan)) {
    // Count current high+standard+null (pre-023 rows) — exclude tier='low'.
    const { count, error: countErr } = await supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId)
      .is('deleted_at', null)
      .or('signal_tier.is.null,signal_tier.neq.low');
    if (countErr) {
      return withCors(NextResponse.json({ error: countErr.message }, { status: 500 }));
    }
    const current = count ?? 0;
    const limit = captureCap(auth.authed.plan);
    // Only count THIS batch's non-low items toward the cap.
    let incoming = 0;
    for (let i = 0; i < clean.length; i++) {
      const s = scoreByIdx.get(i);
      if (!s || s.tier !== 'low') incoming++;
    }
    if (current + incoming > limit) {
      return withCors(
        NextResponse.json(
          buildPlanCapError({
            plan: auth.authed.plan,
            count: current,
            limit,
            attempted: incoming,
            filteredSkipped: clean.length - incoming,
          }),
          { status: 402 }
        )
      );
    }
  }

  // Auto-tag via cluster assignment before insert so the cluster_id + cluster
  // tag land in the same row. Sequential per item (clusters mutate across
  // items in the same batch — two very similar turns should land in the
  // same new cluster, not two fresh ones). Rows without an embedding skip
  // clustering — no vector means no similarity, means no cluster assignment.
  const augmented: Array<{
    user_id: string;
    org_id: string | null;
    content: string;
    source: string | null;
    tags: string[] | null;
    type: string;
    embedding: number[] | null;
    cluster_id: string | null;
    mime: string;
    content_url: string | null;
    content_size: number | null;
    caption: string | null;
    embed_provider: string | null;
    embed_model: string | null;
    embed_dims: number | null;
    session_id: string | null;
    kind: 'turn' | 'digest' | null;
    tool_name: string | null;
    files_touched: string[] | null;
    signal_score: number | null;
    signal_tier: SignalTier | null;
    signal_reason: string | null;
  }> = [];
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const vec = vectorByIdx.get(i) ?? null;
    const score = scoreByIdx.get(i) ?? fallbackScore('no score available');
    const assignment = vec
      ? await assignCluster(supabase, auth.authed.userId, vec, c.embedText)
      : null;
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
      embedding: vec,
      cluster_id: assignment?.clusterId ?? null,
      mime: c.mime,
      content_url: c.contentUrl,
      content_size: c.contentSize,
      caption: c.caption,
      embed_provider: vec ? embedProvider : null,
      embed_model: vec ? embedModel : null,
      embed_dims: vec ? embedDims : null,
      session_id: c.sessionId,
      kind: c.kind,
      tool_name: c.toolName,
      files_touched: c.filesTouched,
      signal_score: score.score,
      signal_tier: score.tier,
      signal_reason: score.reason,
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
  // scanDuplicatesForMemory; we do not await the chain. Skip rows without
  // an embedding (no vector → nothing to compare against).
  for (let i = 0; i < ids.length; i++) {
    if (augmented[i].embedding) {
      void scanDuplicatesForMemory(supabase, auth.authed.userId, ids[i]);
    }
  }

  // Fire-and-forget entity extraction + conflict detection + decision
  // extraction. All three swallow their own errors — none block the
  // response. Skip non-text captures: the extractors only know how to parse
  // text, and a JPEG's caption is too thin a signal. Skip turn rows too —
  // they're high-volume conversation chatter, not stable facts. Brief 023
  // adds: skip low-signal rows (the scorer already said this content is
  // chatter — running 3 more LLM passes on it would burn money + add noise
  // to the entity graph and decisions layer).
  for (let i = 0; i < ids.length; i++) {
    const item = augmented[i];
    if (item.mime === 'text/plain' && item.kind !== 'turn' && item.signal_tier !== 'low') {
      void extractAndIndex(supabase, auth.authed.userId, ids[i], item.content).catch(() => void 0);
      void detectConflicts(supabase, auth.authed.userId, ids[i], item.content).catch(() => void 0);
      void extractDecision(
        supabase,
        auth.authed.userId,
        auth.authed.orgId ?? null,
        ids[i],
        item.content
      );
    }
  }

  // Audit: one row per captured memory + one row per embed call (a single
  // bulk capture is one OpenAI roundtrip but produces N rows of provenance).
  const auditRows: AuditEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const a = augmented[i];
    auditRows.push({
      userId: auth.authed.userId,
      orgId: auth.authed.orgId ?? null,
      op: 'write',
      memoryId: ids[i],
      caller: auth.authed.keyId,
      mime: a.mime,
      embedProvider: a.embedding ? embedProvider : null,
      metadata: {
        source: a.source,
        type: a.type,
        has_url: a.content_url !== null,
        embed_model: a.embedding ? embedModel : null,
        kind: a.kind,
        session_id: a.session_id,
        embedded: a.embedding !== null,
        signal_tier: a.signal_tier,
        signal_score: a.signal_score,
      },
    });
  }
  // One embed audit row covering the batch — only when we actually embedded.
  // A digest-only or all-turns batch with embed_turns=false makes zero
  // OpenAI calls and gets zero embed audit rows.
  if (embedTargets.length > 0) {
    auditRows.push({
      userId: auth.authed.userId,
      orgId: auth.authed.orgId ?? null,
      op: 'embed',
      caller: auth.authed.keyId,
      embedProvider,
      metadata: {
        batch_size: embedTargets.length,
        skipped: ids.length - embedTargets.length,
        embed_model: embedModel,
      },
    });
  }
  logAuditBatchFireForget(auditRows);

  // Invalidate cached hygiene summaries so the next /api/hygiene/summary
  // hit (from the extension or spine_hygiene tool) returns fresh counts.
  // Global tag — acceptable because the underlying query is four cheap
  // head counts per user and a capture is a rare event.
  // TEMPORARILY DISABLED — Next 16 cache API signature change.
  // revalidateTag('hygiene');

  const embedded = vectorByIdx.size;
  // Tier counts for the response — useful for debugging + dashboard live
  // updates without a separate query.
  let tierHigh = 0, tierStandard = 0, tierLow = 0;
  for (const a of augmented) {
    if (a.signal_tier === 'high') tierHigh++;
    else if (a.signal_tier === 'standard') tierStandard++;
    else if (a.signal_tier === 'low') tierLow++;
  }
  const responseBase = {
    embed_provider: embedded > 0 ? embedProvider : null,
    embed_model: embedded > 0 ? embedModel : null,
    embedded,
    skipped: ids.length - embedded,
    tiers: { high: tierHigh, standard: tierStandard, low: tierLow },
  };
  return withCors(
    NextResponse.json(
      Array.isArray(body.bulk)
        ? { ids, ...responseBase }
        : { id: ids[0], ...responseBase }
    )
  );
}
