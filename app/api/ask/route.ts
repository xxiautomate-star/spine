// Cross-AI semantic retrieval with composite ranking.
//
// Algorithm:
//   1. Query preprocessing  — tokenise, extract intent, build query variants
//   2. Embedding            — text-embedding-3-small via OpenAI
//   3. Vector candidate pool — pgvector cosine top-50 + optional BM25 expansion
//   4. Composite re-ranking  — cosine · w_cos + recency · w_rec + source · w_src
//                              + tagOverlap · w_tag + retrievalBoost · w_ret
//                              + contentDensity · w_den - diversityPenalty
//   5. Diversity clip        — penalise near-duplicate results (cos > 0.92)
//   6. Result assembly       — attach continue-URL, group by source AI

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { embedText } from '@/lib/openai';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

// ── Types ──────────────────────────────────────────────────────────────────

type RawCandidate = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
  retrieval_count: number | null;
  last_retrieved_at: string | null;
};

type ScoreSignals = {
  cosine: number;
  recency: number;
  sourceAffinity: number;
  tagOverlap: number;
  retrievalBoost: number;
  contentDensity: number;
};

type ScoreWeights = {
  cosine: number;
  recency: number;
  sourceAffinity: number;
  tagOverlap: number;
  retrievalBoost: number;
  contentDensity: number;
};

const DEFAULT_WEIGHTS: ScoreWeights = {
  cosine:          0.55,
  recency:         0.20,
  sourceAffinity:  0.10,
  tagOverlap:      0.08,
  retrievalBoost:  0.04,
  contentDensity:  0.03,
};

type RankedResult = {
  id: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  scores: {
    cosine: number;
    recency: number;
    composite: number;
  };
  continueUrl: string;
  retrievalCount: number;
};

type AskBody = {
  query?: unknown;
  limit?: unknown;
  sources?: unknown;
  recencyHalfLifeDays?: unknown;
  preferSources?: unknown;
  weights?: unknown;
};

// ── Source metadata ────────────────────────────────────────────────────────

type SourceConfig = {
  label: string;
  continueUrl: (memId: string) => string;
  defaultAffinity: number;
};

const SOURCE_REGISTRY: Record<string, SourceConfig> = {
  'claude.ai': {
    label: 'Claude',
    continueUrl: () => 'https://claude.ai/new',
    defaultAffinity: 0.8,
  },
  'chatgpt': {
    label: 'ChatGPT',
    continueUrl: () => 'https://chatgpt.com/',
    defaultAffinity: 0.8,
  },
  'chatgpt.com': {
    label: 'ChatGPT',
    continueUrl: () => 'https://chatgpt.com/',
    defaultAffinity: 0.8,
  },
  'gemini': {
    label: 'Gemini',
    continueUrl: () => 'https://gemini.google.com/',
    defaultAffinity: 0.7,
  },
  'gemini.google.com': {
    label: 'Gemini',
    continueUrl: () => 'https://gemini.google.com/',
    defaultAffinity: 0.7,
  },
  'v0.dev': {
    label: 'v0',
    continueUrl: () => 'https://v0.dev/',
    defaultAffinity: 0.7,
  },
  'cursor.sh': {
    label: 'Cursor',
    continueUrl: () => 'https://cursor.sh/',
    defaultAffinity: 0.75,
  },
  'codeium.com': {
    label: 'Codeium',
    continueUrl: () => 'https://codeium.com/chat',
    defaultAffinity: 0.7,
  },
};

function getSourceConfig(source: string | null): SourceConfig {
  if (!source) {
    return { label: 'Unknown', continueUrl: () => '#', defaultAffinity: 0.5 };
  }
  return SOURCE_REGISTRY[source] ?? {
    label: source,
    continueUrl: () => '#',
    defaultAffinity: 0.6,
  };
}

// ── Query preprocessing ────────────────────────────────────────────────────

type QueryIntent = 'question' | 'statement' | 'command' | 'lookup';

type ProcessedQuery = {
  raw: string;
  normalised: string;
  terms: string[];
  stopFiltered: string[];
  intent: QueryIntent;
  isRecencyBiased: boolean;  // "recent", "last", "yesterday", "today"
  isSourceBiased: boolean;   // query mentions a specific AI name
  mentionedSources: string[];
};

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','had','has',
  'have','he','her','his','how','i','if','in','is','it','its','me','my',
  'not','of','on','or','our','out','she','so','than','that','the','their',
  'them','then','there','they','this','to','up','was','we','were','what',
  'when','which','who','will','with','you','your',
]);

const RECENCY_TERMS = ['recent', 'latest', 'last', 'yesterday', 'today', 'just', 'new', 'freshest'];
const QUESTION_STARTERS = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'did', 'does', 'can'];

function preprocessQuery(raw: string): ProcessedQuery {
  const normalised = raw.toLowerCase().trim().replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ');
  const allTerms = normalised.split(' ').filter((t) => t.length > 1);
  const stopFiltered = allTerms.filter((t) => !STOP_WORDS.has(t));

  const firstWord = allTerms[0] ?? '';
  let intent: QueryIntent = 'statement';
  if (QUESTION_STARTERS.includes(firstWord) || raw.endsWith('?')) intent = 'question';
  else if (['find', 'show', 'get', 'list', 'give'].includes(firstWord)) intent = 'command';
  else if (allTerms.length <= 3) intent = 'lookup';

  const isRecencyBiased = RECENCY_TERMS.some((t) => normalised.includes(t));

  const aiNames: Record<string, string[]> = {
    'claude.ai':         ['claude', 'anthropic'],
    'chatgpt.com':       ['chatgpt', 'openai', 'gpt'],
    'gemini.google.com': ['gemini', 'bard', 'google ai'],
    'v0.dev':            ['v0', 'vercel'],
    'cursor.sh':         ['cursor'],
    'codeium.com':       ['codeium', 'windsurf'],
  };
  const mentionedSources: string[] = [];
  for (const [src, aliases] of Object.entries(aiNames)) {
    if (aliases.some((a) => normalised.includes(a))) mentionedSources.push(src);
  }

  return {
    raw,
    normalised,
    terms: allTerms,
    stopFiltered,
    intent,
    isRecencyBiased,
    isSourceBiased: mentionedSources.length > 0,
    mentionedSources,
  };
}

// Generate a secondary query variant for richer candidate retrieval.
// For questions, rephrase as a statement that an archive might contain.
function buildQueryVariant(pq: ProcessedQuery): string | null {
  if (pq.intent === 'question' && pq.stopFiltered.length >= 2) {
    return pq.stopFiltered.join(' ');
  }
  if (pq.intent === 'lookup' && pq.terms.length >= 1) {
    return `decided ${pq.terms.join(' ')} because`;
  }
  return null;
}

// ── Scoring functions ──────────────────────────────────────────────────────

// Exponential recency decay. λ = half-life in days.
// score = exp(-days_since / λ), giving 1.0 for today, ~0.5 at λ days, ~0.13 at 2λ.
function recencyScore(createdAt: string, halfLifeDays: number): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  if (isNaN(created)) return 0.5;
  const daysSince = (now - created) / 86_400_000;
  // Clamp minimum to 0.02 — very old memories shouldn't score zero entirely.
  return Math.max(0.02, Math.exp(-(daysSince / halfLifeDays) * Math.LN2));
}

// Source affinity: user's preferred sources score higher.
// preferSources = list of source strings the user passed in the request.
// If no preference, use the default affinity from SOURCE_REGISTRY.
function sourceAffinityScore(
  source: string | null,
  preferSources: string[],
  pq: ProcessedQuery
): number {
  const src = source ?? '';
  const config = getSourceConfig(source);

  // Strong boost if the query explicitly mentions this AI by name.
  if (pq.isSourceBiased && pq.mentionedSources.includes(src)) return 1.0;

  // User passed explicit preferred sources.
  if (preferSources.length > 0) {
    const preferred = preferSources.some((p) => src.includes(p) || p.includes(src));
    return preferred ? 0.95 : 0.3;
  }

  return config.defaultAffinity;
}

// Tag overlap: fraction of query stop-filtered terms appearing in tags or content.
// Weighted: exact tag match counts double.
function tagOverlapScore(
  content: string,
  tags: string[] | null,
  queryTerms: string[]
): number {
  if (queryTerms.length === 0) return 0.5;
  const lowerContent = content.toLowerCase();
  const lowerTags = (tags ?? []).map((t) => t.toLowerCase());
  let hits = 0;
  for (const term of queryTerms) {
    const inContent = lowerContent.includes(term) ? 0.5 : 0;
    const inTag = lowerTags.some((t) => t.includes(term) || term.includes(t)) ? 1.0 : 0;
    hits += Math.max(inContent, inTag);
  }
  return Math.min(1.0, hits / queryTerms.length);
}

// Retrieval frequency boost: memories the user has returned to before are
// more signal-rich. Logarithmic to avoid massive outlier amplification.
function retrievalBoostScore(retrievalCount: number | null): number {
  const n = retrievalCount ?? 0;
  if (n <= 0) return 0.0;
  return Math.min(1.0, Math.log(n + 1) / Math.log(20));
}

// Content density: very short memories carry less signal; very long ones
// have diminishing returns. Optimum around 150-500 chars.
function contentDensityScore(content: string): number {
  const len = content.length;
  if (len < 20) return 0.1;
  if (len < 80) return 0.4;
  if (len <= 600) return 1.0;
  // Gentle penalty for very long captures — they're usually noisier.
  return Math.max(0.5, 1.0 - (len - 600) / 4000);
}

// Composite score: weighted linear combination of all signals, normalised to [0,1].
function compositeScore(signals: ScoreSignals, weights: ScoreWeights): number {
  const total =
    signals.cosine          * weights.cosine +
    signals.recency         * weights.recency +
    signals.sourceAffinity  * weights.sourceAffinity +
    signals.tagOverlap      * weights.tagOverlap +
    signals.retrievalBoost  * weights.retrievalBoost +
    signals.contentDensity  * weights.contentDensity;

  const weightSum =
    weights.cosine + weights.recency + weights.sourceAffinity +
    weights.tagOverlap + weights.retrievalBoost + weights.contentDensity;

  return total / weightSum;
}

// ── Diversity re-ranking ───────────────────────────────────────────────────

// Simple greedy diversity: given a ranked list, penalise any result whose
// content is very similar to an already-selected result.
// Uses Jaccard similarity on unigrams as a cheap proxy for cosine similarity.
function jaccardUnigrams(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DIVERSITY_THRESHOLD = 0.72;  // Jaccard sim above this → near-duplicate
const DIVERSITY_PENALTY = 0.35;    // Multiply composite by this to penalise

function applyDiversityPenalty(
  candidates: Array<RawCandidate & { composite: number }>
): Array<RawCandidate & { composite: number }> {
  const selected: string[] = [];
  return candidates.map((c) => {
    const maxSim = selected.reduce((best, prev) => {
      return Math.max(best, jaccardUnigrams(c.content, prev));
    }, 0);

    if (selected.length === 0 || maxSim < DIVERSITY_THRESHOLD) {
      selected.push(c.content);
      return c;
    }
    // Near-duplicate — suppress.
    return { ...c, composite: c.composite * DIVERSITY_PENALTY };
  });
}

// ── Continue URL generation ────────────────────────────────────────────────

function continueUrl(source: string | null, memId: string): string {
  const config = getSourceConfig(source);
  return config.continueUrl(memId);
}

// ── Supabase retrieval ─────────────────────────────────────────────────────

async function fetchCandidates(
  userId: string,
  embedding: number[],
  limit: number,
  sourceFilter: string[]
): Promise<RawCandidate[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const rpcLimit = Math.min(50, limit * 5); // Over-fetch for re-ranking.

  // Primary: pgvector cosine similarity.
  const { data: vectorData, error: vectorError } = await supabase.rpc('spine_match_memories', {
    p_user: userId,
    p_query_embedding: embedding,
    p_limit: rpcLimit,
  });

  if (vectorError) {
    console.error('[spine/ask] vector search error:', vectorError.message);
    return [];
  }

  let rows = (vectorData ?? []) as Array<{
    id: string;
    content: string;
    source: string | null;
    tags: string[] | null;
    created_at: string;
    similarity: number;
  }>;

  // Fetch retrieval_count + last_retrieved_at for the matched IDs.
  // Defense-in-depth: explicit user_id filter even though spine_match_memories
  // already scopes by user at the SQL level. Spine uses the service-role
  // client (RLS bypassed); without this filter, an RPC bug or future schema
  // change could leak cross-tenant rows via this metadata fetch. Gate-1
  // audit fix.
  const ids = rows.map((r) => r.id);
  let retrievalMeta: Map<string, { retrieval_count: number; last_retrieved_at: string | null }>;

  if (ids.length > 0) {
    const { data: metaData } = await supabase
      .from('memories')
      .select('id, retrieval_count, last_retrieved_at')
      .in('id', ids)
      .eq('user_id', userId)
      .is('deleted_at', null);

    retrievalMeta = new Map(
      (metaData ?? []).map((m: { id: string; retrieval_count: number | null; last_retrieved_at: string | null }) => [
        m.id,
        { retrieval_count: m.retrieval_count ?? 0, last_retrieved_at: m.last_retrieved_at ?? null },
      ])
    );
  } else {
    retrievalMeta = new Map();
  }

  // Apply source filter if given.
  if (sourceFilter.length > 0) {
    rows = rows.filter((r) =>
      r.source && sourceFilter.some((f) => r.source!.includes(f) || f.includes(r.source!))
    );
  }

  return rows.map((r) => {
    const meta = retrievalMeta.get(r.id);
    return {
      id: r.id,
      content: r.content,
      source: r.source,
      tags: r.tags,
      created_at: r.created_at,
      similarity: r.similarity,
      retrieval_count: meta?.retrieval_count ?? 0,
      last_retrieved_at: meta?.last_retrieved_at ?? null,
    };
  });
}

// ── Weight overrides ───────────────────────────────────────────────────────

function parseWeights(raw: unknown): Partial<ScoreWeights> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<ScoreWeights> = {};
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof ScoreWeights>) {
    const v = r[key];
    if (typeof v === 'number' && v >= 0 && v <= 1) out[key] = v;
  }
  return out;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) {
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }

  let body: AskBody;
  try {
    body = (await req.json()) as AskBody;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }));
  }

  const queryRaw = typeof body.query === 'string' ? body.query.trim() : '';
  if (!queryRaw || queryRaw.length < 2) {
    return withCors(NextResponse.json({ error: 'query must be at least 2 characters.' }, { status: 400 }));
  }
  if (queryRaw.length > 2000) {
    return withCors(NextResponse.json({ error: 'query too long (max 2000 chars).' }, { status: 400 }));
  }

  const limit = Math.max(1, Math.min(25, typeof body.limit === 'number' ? Math.floor(body.limit) : 10));
  const sources = Array.isArray(body.sources)
    ? (body.sources as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const preferSources = Array.isArray(body.preferSources)
    ? (body.preferSources as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const halfLife = typeof body.recencyHalfLifeDays === 'number' && body.recencyHalfLifeDays > 0
    ? body.recencyHalfLifeDays
    : 30;
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...parseWeights(body.weights) };

  const pq = preprocessQuery(queryRaw);

  // Adjust weights based on query characteristics.
  if (pq.isRecencyBiased) {
    weights.recency += 0.12;
    weights.cosine -= 0.06;
    weights.sourceAffinity -= 0.06;
  }
  if (pq.intent === 'lookup') {
    weights.tagOverlap += 0.06;
    weights.cosine -= 0.04;
    weights.contentDensity -= 0.02;
  }
  if (pq.isSourceBiased) {
    weights.sourceAffinity += 0.15;
    weights.cosine -= 0.08;
    weights.recency -= 0.07;
  }

  // Build query string for embedding — use stop-filtered terms if the query
  // is long enough that stop words add noise.
  const embedQuery =
    pq.terms.length > 8 ? pq.stopFiltered.join(' ') || queryRaw : queryRaw;

  const t0 = Date.now();
  let embedding: number[];
  try {
    embedding = await embedText(embedQuery);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return withCors(NextResponse.json({ error: `Embedding failed: ${msg}` }, { status: 503 }));
  }
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const candidates = await fetchCandidates(auth.authed.userId, embedding, limit, sources);
  const searchMs = Date.now() - t1;

  if (candidates.length === 0) {
    return withCors(
      NextResponse.json({
        results: [],
        query: queryRaw,
        intent: pq.intent,
        embedMs,
        searchMs,
        totalMs: Date.now() - t0,
      })
    );
  }

  // Score every candidate.
  const scored = candidates.map((c) => {
    const signals: ScoreSignals = {
      cosine:         c.similarity,
      recency:        recencyScore(c.created_at, halfLife),
      sourceAffinity: sourceAffinityScore(c.source, preferSources, pq),
      tagOverlap:     tagOverlapScore(c.content, c.tags, pq.stopFiltered),
      retrievalBoost: retrievalBoostScore(c.retrieval_count),
      contentDensity: contentDensityScore(c.content),
    };
    return { ...c, composite: compositeScore(signals, weights), signals };
  });

  // Sort by composite descending.
  scored.sort((a, b) => b.composite - a.composite);

  // Diversity re-ranking.
  const diversified = applyDiversityPenalty(scored);
  diversified.sort((a, b) => b.composite - a.composite);

  // Take top-N.
  const top = diversified.slice(0, limit);

  // Assemble response.
  const results: RankedResult[] = top.map((c) => ({
    id: c.id,
    content: c.content,
    source: c.source ?? 'unknown',
    tags: c.tags ?? [],
    createdAt: c.created_at,
    scores: {
      cosine: Math.round(c.similarity * 1000) / 1000,
      recency: Math.round(recencyScore(c.created_at, halfLife) * 1000) / 1000,
      composite: Math.round(c.composite * 1000) / 1000,
    },
    continueUrl: continueUrl(c.source, c.id),
    retrievalCount: c.retrieval_count ?? 0,
  }));

  // Group by source for the client's grouping UI.
  const bySource = results.reduce<Record<string, RankedResult[]>>((acc, r) => {
    const key = r.source;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return withCors(
    NextResponse.json({
      results,
      bySource,
      query: queryRaw,
      intent: pq.intent,
      terms: pq.stopFiltered,
      mentionedSources: pq.mentionedSources,
      weights,
      embedMs,
      searchMs,
      totalMs: Date.now() - t0,
    })
  );
}
