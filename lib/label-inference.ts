// Real-label inference from the user's own next turn.
//
// When a client calls /api/spine-feedback with a new user turn, we look up
// recall queries from the last 10 minutes for that (user, session), pull
// their candidates, and check whether the turn text contains substantial
// overlap with any shown candidate's content.
//
// Overlap rule (tuned for implicit citation, not paraphrase):
//   - Normalize both strings (lower, strip punctuation, collapse whitespace)
//   - Extract 5-gram word sequences from the candidate's content_preview
//   - A match means ≥2 distinct 5-grams appear in the turn, OR a single
//     7-gram appears. The confidence score scales with match count.
//
// This isn't semantic paraphrase detection — it's citation detection. When a
// user says "as spine mentioned, we chose text-embedding-3-small", the
// 5-grams from that memory light up. When a user says "we picked the small
// model" without quoting phrasing, we don't flag it. False negatives are the
// safe failure mode.

import { getSupabase } from './supabase';

const LOOKBACK_MS = 10 * 60 * 1000;

export type InferredLabel = {
  queryId: string;
  memoryId: string;
  wasUsed: boolean;
  confidence: number;
  matchedText: string | null;
  signalType: 'quoted_phrase' | 'no_match';
};

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalise(s).split(' ').filter(Boolean);
}

function ngrams(words: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) {
    out.add(words.slice(i, i + n).join(' '));
  }
  return out;
}

function countOverlap(turnText: string, candidatePreview: string): {
  fiveGramHits: number;
  sevenGramHit: string | null;
} {
  const turnWords = tokens(turnText);
  const candWords = tokens(candidatePreview);

  if (turnWords.length < 5 || candWords.length < 5) {
    return { fiveGramHits: 0, sevenGramHit: null };
  }

  const turnSet5 = ngrams(turnWords, 5);
  const cand5 = ngrams(candWords, 5);
  let fiveGramHits = 0;
  for (const g of cand5) if (turnSet5.has(g)) fiveGramHits++;

  let sevenGramHit: string | null = null;
  if (turnWords.length >= 7 && candWords.length >= 7) {
    const turnSet7 = ngrams(turnWords, 7);
    for (const g of ngrams(candWords, 7)) {
      if (turnSet7.has(g)) {
        sevenGramHit = g;
        break;
      }
    }
  }

  return { fiveGramHits, sevenGramHit };
}

export function classifyOverlap(turnText: string, candidatePreview: string): {
  wasUsed: boolean;
  confidence: number;
  matchedText: string | null;
} {
  const { fiveGramHits, sevenGramHit } = countOverlap(turnText, candidatePreview);
  if (sevenGramHit) {
    return { wasUsed: true, confidence: 0.95, matchedText: sevenGramHit };
  }
  if (fiveGramHits >= 2) {
    return { wasUsed: true, confidence: Math.min(0.85, 0.5 + 0.15 * fiveGramHits), matchedText: null };
  }
  return { wasUsed: false, confidence: 0, matchedText: null };
}

/**
 * Scan the last-10-min recall queries for (userId, sessionId), compare each
 * candidate against the new turn, write labels. Returns how many positive
 * labels we wrote so the caller can include it in the response for debugging.
 */
export async function inferLabelsFromTurn(args: {
  userId: string | null;
  sessionId: string | null;
  turnText: string;
}): Promise<{ labelsWritten: number; positiveCount: number; negativeCount: number }> {
  const supabase = getSupabase();
  if (!supabase) return { labelsWritten: 0, positiveCount: 0, negativeCount: 0 };

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  let qb = supabase
    .from('saas_spine_recall_queries')
    .select('id, user_id, session_id, shown_ids')
    .gte('created_at', since)
    .limit(50);
  if (args.userId) qb = qb.eq('user_id', args.userId);
  if (args.sessionId) qb = qb.eq('session_id', args.sessionId);

  const { data: queries } = await qb;
  if (!queries || queries.length === 0) {
    return { labelsWritten: 0, positiveCount: 0, negativeCount: 0 };
  }

  const queryIds = queries.map((q) => q.id as string);

  // Pull candidates for those queries — we want all 20, not just shown, so a
  // memory that was in the pool but missed top-K can still get a negative
  // training row when the user cites a different memory.
  const { data: candidates } = await supabase
    .from('saas_spine_recall_candidates')
    .select('query_id, memory_id, content_preview, rank_shown')
    .in('query_id', queryIds);

  if (!candidates || candidates.length === 0) {
    return { labelsWritten: 0, positiveCount: 0, negativeCount: 0 };
  }

  const labelRows: Array<{
    query_id: string;
    memory_id: string;
    was_used: boolean;
    signal_type: string;
    confidence: number;
    matched_text: string | null;
  }> = [];

  let positives = 0;
  let negatives = 0;

  for (const c of candidates) {
    if (!c.memory_id || !c.content_preview) continue;
    // Only label candidates that were actually SHOWN — a memory not in the
    // user's context window can't have been "cited" by them.
    if (c.rank_shown === null) continue;

    const { wasUsed, confidence, matchedText } = classifyOverlap(
      args.turnText,
      c.content_preview as string
    );

    if (wasUsed) positives++;
    else negatives++;

    labelRows.push({
      query_id: c.query_id as string,
      memory_id: c.memory_id as string,
      was_used: wasUsed,
      signal_type: wasUsed ? 'quoted_phrase' : 'no_match',
      confidence,
      matched_text: matchedText,
    });
  }

  if (labelRows.length === 0) return { labelsWritten: 0, positiveCount: 0, negativeCount: 0 };

  // Upsert — duplicates on (query_id, memory_id, signal_type) are ignored.
  await supabase.from('saas_spine_recall_labels').upsert(labelRows, {
    onConflict: 'query_id,memory_id,signal_type',
    ignoreDuplicates: true,
  });

  return { labelsWritten: labelRows.length, positiveCount: positives, negativeCount: negatives };
}
