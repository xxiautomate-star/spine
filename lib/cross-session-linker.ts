// Cross-session linker: given a query being typed into Claude (or any AI),
// embed it and find past captures that answer the same question.
//
// Target latency: <100ms p95 (cache hit) / <300ms (cache miss + embed).
// The extension polls this endpoint on input-idle (800ms debounce).
//
// Match threshold: 0.82 cosine. Below this, the query is novel — no HUD.
// Between 0.82 and 0.92: surface the match with moderate confidence.
// Above 0.92: surface with high confidence ("you solved this exactly").
//
// The HUD text is generated from the matched memory content directly —
// no extra LLM call required. The extension renders it inline.

import { embedText } from './openai';
import { getSupabase } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────

export type MatchConfidence = 'exact' | 'related' | 'none';

export type ContextMatch = {
  matched: true;
  memoryId: string;
  content: string;
  source: string | null;
  createdAt: string;
  similarity: number;
  confidence: MatchConfidence;
  headline: string;     // Short HUD headline
  snippet: string;      // Truncated content for the HUD card
  continueUrl: string;  // Direct link back to the source conversation
};

export type NoMatch = {
  matched: false;
  reason: 'below_threshold' | 'no_memories' | 'embed_failed' | 'db_error';
};

export type LinkResult = ContextMatch | NoMatch;

// ── Constants ─────────────────────────────────────────────────────────────

const THRESHOLD_RELATED = 0.82;
const THRESHOLD_EXACT = 0.92;
const MIN_QUERY_LENGTH = 18;   // Don't match on very short queries
const MAX_QUERY_LENGTH = 2000; // Trim runaway inputs

// ── Snippet + headline helpers ─────────────────────────────────────────────

function makeSnippet(content: string, maxLen = 220): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.lastIndexOf(' ', maxLen);
  return (cut > 80 ? trimmed.slice(0, cut) : trimmed.slice(0, maxLen)) + '…';
}

function makeHeadline(similarity: number, daysAgo: number): string {
  const when =
    daysAgo === 0 ? 'earlier today'
    : daysAgo === 1 ? 'yesterday'
    : daysAgo < 7 ? `${daysAgo} days ago`
    : daysAgo < 30 ? `${Math.floor(daysAgo / 7)} weeks ago`
    : `${Math.floor(daysAgo / 30)} months ago`;

  if (similarity >= THRESHOLD_EXACT) {
    return `You solved this ${when}.`;
  }
  return `Related answer from ${when}.`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function makeContinueUrl(source: string | null): string {
  if (!source) return '#';
  // Map known sources to their base URL pattern.
  const sourceUrls: Record<string, string> = {
    'claude.ai': 'https://claude.ai',
    'chatgpt.com': 'https://chatgpt.com',
    'gemini.google.com': 'https://gemini.google.com',
    'v0.dev': 'https://v0.dev',
    'cursor.sh': 'https://cursor.sh',
    'codeium.com': 'https://codeium.com/chat',
  };
  return sourceUrls[source] ?? '#';
}

// ── In-memory LRU for embedding cache ────────────────────────────────────
// Keyed by normalised query text. Survives within a single Edge invocation
// but not across cold starts — that's fine for the <100ms goal.

type CacheEntry = { embedding: number[]; ts: number };
const EMBED_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

function cacheKey(query: string): string {
  // Normalise: lowercase, collapse whitespace, trim.
  return query.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 512);
}

async function getCachedEmbedding(query: string): Promise<number[]> {
  const key = cacheKey(query);
  const hit = EMBED_CACHE.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.embedding;

  const embedding = await embedText(query);

  // Evict oldest entry when cache is full.
  if (EMBED_CACHE.size >= CACHE_MAX) {
    let oldest = 0;
    let oldestKey = '';
    for (const [k, v] of EMBED_CACHE) {
      if (oldestKey === '' || v.ts < oldest) { oldest = v.ts; oldestKey = k; }
    }
    if (oldestKey) EMBED_CACHE.delete(oldestKey);
  }

  EMBED_CACHE.set(key, { embedding, ts: Date.now() });
  return embedding;
}

// ── Core match function ────────────────────────────────────────────────────

/**
 * Find the best past capture matching the current query for a user.
 * Returns `NoMatch` if nothing crosses the threshold.
 */
export async function findContextMatch(
  userId: string,
  rawQuery: string
): Promise<LinkResult> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) {
    return { matched: false, reason: 'below_threshold' };
  }

  const sb = getSupabase();
  if (!sb) return { matched: false, reason: 'db_error' };

  let embedding: number[];
  try {
    embedding = await getCachedEmbedding(query);
  } catch {
    return { matched: false, reason: 'embed_failed' };
  }

  type MatchRow = {
    id: string;
    content: string;
    source: string | null;
    created_at: string;
    similarity: number;
  };

  const { data, error } = await sb.rpc('spine_match_memories', {
    p_user: userId,
    p_query_embedding: embedding,
    p_limit: 3,
  }) as { data: MatchRow[] | null; error: unknown };

  if (error || !data) return { matched: false, reason: 'db_error' };
  if (data.length === 0) return { matched: false, reason: 'no_memories' };

  const best = data[0];
  const similarity = best.similarity;

  if (similarity < THRESHOLD_RELATED) {
    return { matched: false, reason: 'below_threshold' };
  }

  const confidence: MatchConfidence =
    similarity >= THRESHOLD_EXACT ? 'exact' : 'related';

  const daysAgo = daysBetween(new Date(best.created_at), new Date());

  return {
    matched: true,
    memoryId: best.id,
    content: best.content,
    source: best.source,
    createdAt: best.created_at,
    similarity,
    confidence,
    headline: makeHeadline(similarity, daysAgo),
    snippet: makeSnippet(best.content),
    continueUrl: makeContinueUrl(best.source),
  };
}

// ── Batch link (for digest cross-referencing) ──────────────────────────────

/**
 * For a list of open questions from the digest, check each against the
 * memory archive to see if a past capture already addresses it.
 * Returns one `LinkResult` per question.
 */
export async function linkQuestions(
  userId: string,
  questions: string[]
): Promise<LinkResult[]> {
  const results: LinkResult[] = [];
  for (const q of questions) {
    // Brief pause between embeds to avoid bursting the rate limit.
    if (results.length > 0) await new Promise((r) => setTimeout(r, 50));
    results.push(await findContextMatch(userId, q));
  }
  return results;
}

// ── HUD content builder (used by the extension content script) ────────────

/**
 * Build the HTML string for the HUD card injected by the extension.
 * Deliberately inline styles — the content script runs in arbitrary page
 * contexts and must not rely on any external CSS.
 */
export function buildHudHtml(match: ContextMatch): string {
  const confidenceColor = match.confidence === 'exact' ? '#E89A3C' : '#4A5E7A';
  const borderColor = match.confidence === 'exact'
    ? 'rgba(232,154,60,0.35)'
    : 'rgba(74,94,122,0.35)';

  const sourceLabel = match.source ?? 'your archive';
  const date = new Date(match.createdAt).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  return `<div id="spine-hud" style="
    position:fixed;
    bottom:80px;
    right:20px;
    z-index:2147483647;
    max-width:360px;
    background:rgba(13,12,10,0.96);
    border:1px solid ${borderColor};
    border-radius:12px;
    padding:16px;
    box-shadow:0 8px 40px rgba(0,0,0,0.6);
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    color:#E8E4DD;
    animation:spineSlideIn 0.3s cubic-bezier(0.2,0.7,0.2,1) both;
  ">
    <style>
      @keyframes spineSlideIn {
        from { opacity:0; transform:translateY(10px); }
        to   { opacity:1; transform:translateY(0); }
      }
    </style>
    <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
      <div style="width:6px;height:6px;border-radius:50%;background:${confidenceColor};flex-shrink:0;margin-top:5px;"></div>
      <div>
        <p style="margin:0;font-size:12px;font-weight:600;color:${confidenceColor};letter-spacing:0.02em;">
          ${match.headline}
        </p>
        <p style="margin:2px 0 0;font-size:10px;color:rgba(232,228,221,0.35);font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:0.08em;">
          ${sourceLabel} · ${date}
        </p>
      </div>
      <button onclick="document.getElementById('spine-hud').remove()" style="
        margin-left:auto;flex-shrink:0;background:none;border:none;cursor:pointer;
        color:rgba(232,228,221,0.3);font-size:16px;line-height:1;padding:0;
      ">×</button>
    </div>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:rgba(232,228,221,0.75);">
      ${match.snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
    </p>
    <div style="display:flex;align-items:center;gap:12px;">
      ${match.continueUrl !== '#' ? `<a href="${match.continueUrl}" target="_blank" style="
        font-size:10px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:0.1em;
        color:${confidenceColor};text-decoration:none;border-bottom:1px solid rgba(232,154,60,0.3);
        padding-bottom:1px;
      ">Continue →</a>` : ''}
      <a href="https://spine.xxiautomate.com/timeline" target="_blank" style="
        font-size:10px;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:0.1em;
        color:rgba(232,228,221,0.3);text-decoration:none;
      ">Open archive</a>
    </div>
  </div>`;
}
