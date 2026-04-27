// Decision extraction: distil decisions out of newly-captured memories.
//
// A "decision" is a one-sentence statement of an action chosen, a tool
// picked, a tradeoff resolved, a hypothesis adopted. We extract them as a
// derived layer because:
//   1. Raw recall is bad at "what did we decide?" — decisions span many
//      captures and need to be aggregated to surface
//   2. Decisions evolve — superseding chains let us answer "what is the
//      *current* answer?" without scanning the whole archive
//   3. They are visually distinctive in the constellation graph and form
//      the second viral screenshot ("my AI tracked every decision I made")
//
// Pipeline: capture/route.ts → extractDecisionFromMemory(...).catch(noop)
// Never blocks the response. Failures are silent — the worst case is one
// memory without a decision row, not a broken capture.

import { SupabaseClient } from '@supabase/supabase-js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

// Skip extraction for content this short — usually fragments, prompts, or
// system messages with no decision substance.
const MIN_CONTENT_LEN = 60;

// Haiku self-reported confidence below which we drop the extraction.
// Tuned empirically: 0.65 catches strong decisions while excluding the
// "could be a decision, hard to tell" gray zone that floods the dashboard.
const MIN_CONFIDENCE = 0.65;

const SYSTEM_PROMPT = `You are a decision extractor for a memory system.

Given a captured note from a user's AI-coding session, decide whether it contains a DECISION — an action chosen, tool picked, tradeoff resolved, hypothesis adopted, or course set. Return the decision distilled into one short sentence (≤180 chars), the user's words preferred, present tense.

Rules:
- ONLY extract genuine decisions. Skip questions, observations, status updates, error messages, and ambient context.
- If multiple decisions appear, return the MOST CONSEQUENTIAL one. Memory captures are short; one decision per row keeps the layer clean.
- The statement must be self-contained — read 30 days later, it should still make sense without the surrounding conversation.
- Confidence ≥ 0.65 means "I'm sure this is a decision." Below that, return is_decision: false.
- Prefer factual phrasing: "we use X" not "let's use X." "Stripe blocked until 18" not "we can't use Stripe."

Tags: 0–3 lowercase tokens that categorise the decision (e.g. "stack", "pricing", "infra", "ux", "legal"). No spaces in a tag.

Respond with EXACTLY this JSON, no markdown fences:
{"is_decision": true|false, "statement": "...", "confidence": 0.00, "tags": ["...", "..."]}

If is_decision is false, statement and tags can be empty.`;

export type ExtractionResult =
  | { extracted: false; reason: 'too_short' | 'low_confidence' | 'not_decision' | 'error' | 'no_key'; error?: string }
  | { extracted: true; decisionId: string; statement: string; confidence: number; tags: string[] };

type HaikuResponse = {
  is_decision: boolean;
  statement: string;
  confidence: number;
  tags: string[];
};

async function callHaiku(content: string): Promise<HaikuResponse | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        // System prompt is cached — every extraction call after the first
        // within 5 minutes reads the cached system, dropping cost ~80%.
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: content.slice(0, 1500) }],
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const raw = data.content?.[0]?.text?.trim() ?? '';
    if (!raw) return null;

    // Strip markdown fences if Haiku adds them despite instructions.
    const jsonStr = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as HaikuResponse;

    if (typeof parsed.is_decision !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

function clampTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
    .filter((t) => t.length > 0 && t.length <= 32)
    .slice(0, 3);
}

function buildContext(content: string): string {
  // Surrounding excerpt for the dashboard display. Single chunk — Haiku's
  // statement gives the headline, this shows the user the original wording
  // when they expand the row. ≤500 chars to keep the row light.
  return content.slice(0, 500);
}

export async function extractDecisionFromMemory(
  supabase: SupabaseClient,
  userId: string,
  orgId: string | null,
  memoryId: string,
  content: string
): Promise<ExtractionResult> {
  if (!content || content.length < MIN_CONTENT_LEN) {
    return { extracted: false, reason: 'too_short' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { extracted: false, reason: 'no_key' };
  }

  const haiku = await callHaiku(content);
  if (!haiku) return { extracted: false, reason: 'error' };

  if (!haiku.is_decision) return { extracted: false, reason: 'not_decision' };

  const confidence = typeof haiku.confidence === 'number' ? Math.max(0, Math.min(1, haiku.confidence)) : 0;
  if (confidence < MIN_CONFIDENCE) return { extracted: false, reason: 'low_confidence' };

  const statement = typeof haiku.statement === 'string' ? haiku.statement.trim().slice(0, 240) : '';
  if (!statement) return { extracted: false, reason: 'low_confidence' };

  const tags = clampTags(haiku.tags);

  const { data, error } = await supabase
    .from('decisions')
    .insert({
      user_id: userId,
      org_id: orgId,
      source_memory_id: memoryId,
      statement,
      context: buildContext(content),
      status: 'active',
      confidence,
      tags: tags.length > 0 ? tags : null,
      metadata: { extractor: 'haiku-4-5', model: MODEL },
    })
    .select('id')
    .single();

  if (error || !data) {
    return { extracted: false, reason: 'error', error: error?.message };
  }

  // Link the source memory as supporting evidence. Future memories that
  // touch this decision can be added via decision_evidence by a follow-up
  // extractor (out of scope for v1).
  void supabase
    .from('decision_evidence')
    .insert({
      decision_id: data.id as string,
      memory_id: memoryId,
      relation: 'supports',
      weight: 1.0,
    })
    .then(() => void 0);

  return {
    extracted: true,
    decisionId: data.id as string,
    statement,
    confidence,
    tags,
  };
}

// Wrapper that fits the fire-and-forget pattern used by capture-route.ts:
// no return value, swallows all errors. The caller does
// `void extractDecision(...)` and never awaits.
export function extractDecision(
  supabase: SupabaseClient,
  userId: string,
  orgId: string | null,
  memoryId: string,
  content: string
): Promise<void> {
  return extractDecisionFromMemory(supabase, userId, orgId, memoryId, content)
    .then(() => void 0)
    .catch(() => void 0);
}
