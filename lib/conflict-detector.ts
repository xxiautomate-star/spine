// Conflict detection: compare new capture against prior captures of the same entities.
// If Haiku detects a contradiction, creates a memory_conflicts row.
// Fire-and-forget — called from capture route, never blocks the response.

import { SupabaseClient } from '@supabase/supabase-js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const CONFLICT_SIMILARITY_THRESHOLD = 0.78; // broad net — haiku filters false positives
const MAX_CANDIDATES = 5;

interface MemoryCandidate {
  id: string;
  content: string;
  created_at: string;
}

interface ConflictResult {
  detected: boolean;
  quoteA?: string;
  quoteB?: string;
  entityName?: string;
}

async function callHaikuConflict(
  textA: string,
  textB: string
): Promise<ConflictResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { detected: false };

  const system = `You are a contradiction detector for a memory system.
Given two text passages (A = older, B = newer), determine if B contradicts or supersedes a specific claim in A.

Rules:
- Only flag FACTUAL contradictions about entities (tools, people, projects, decisions, prices, timelines).
- Ignore tone differences, additions, or elaborations that don't contradict.
- DO NOT flag if A is a question and B is an answer — that is clarification, not contradiction.
- DO NOT flag if both statements could be simultaneously true.

Respond with exactly this JSON (no markdown):
{"contradicts": true|false, "quote_a": "...", "quote_b": "...", "entity": "..."}

If no contradiction: {"contradicts": false, "quote_a": "", "quote_b": "", "entity": ""}
quote_a and quote_b must be verbatim excerpts (≤120 chars each). entity is the name of the thing being contradicted.`;

  const userMsg = `PASSAGE A (older memory):\n${textA.slice(0, 800)}\n\nPASSAGE B (newer capture):\n${textB.slice(0, 800)}`;

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
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!res.ok) return { detected: false };
    const data = (await res.json()) as { content?: { text?: string }[] };
    const raw = data.content?.[0]?.text?.trim() ?? '';

    // strip markdown fences if Haiku adds them despite instructions
    const jsonStr = raw.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      contradicts: boolean;
      quote_a: string;
      quote_b: string;
      entity: string;
    };

    if (parsed.contradicts && parsed.quote_a && parsed.quote_b) {
      return {
        detected: true,
        quoteA: parsed.quote_a,
        quoteB: parsed.quote_b,
        entityName: parsed.entity || undefined,
      };
    }
    return { detected: false };
  } catch {
    return { detected: false };
  }
}

export async function detectConflicts(
  sb: SupabaseClient,
  userId: string,
  newMemoryId: string,
  newContent: string
): Promise<void> {
  // 1. Find candidates via embedding similarity (reuse stored embedding)
  const { data: candidates } = await sb.rpc('spine_match_memories', {
    query_embedding: await getStoredEmbedding(sb, newMemoryId),
    match_user_id: userId,
    match_threshold: CONFLICT_SIMILARITY_THRESHOLD,
    match_count: MAX_CANDIDATES,
  }) as { data: Array<{ id: string; content: string; similarity: number }> | null };

  if (!candidates || candidates.length === 0) return;

  // Exclude the memory itself (shouldn't be in results, but guard anyway)
  const prior = candidates.filter((c) => c.id !== newMemoryId);
  if (prior.length === 0) return;

  // 2. Fetch full content for each candidate (rpc returns truncated snippets)
  const { data: fullRows } = await sb
    .from('memories')
    .select('id, content, created_at')
    .in(
      'id',
      prior.map((p) => p.id)
    )
    .is('deleted_at', null)
    .is('archived_at', null)
    .neq('id', newMemoryId);

  if (!fullRows || fullRows.length === 0) return;

  // 3. Check each candidate for contradiction, serially (avoid parallel Haiku calls)
  for (const row of fullRows as MemoryCandidate[]) {
    const result = await callHaikuConflict(row.content, newContent);
    if (!result.detected) continue;

    // 4. Insert conflict row (ignore if duplicate pair already exists)
    await sb.from('memory_conflicts').upsert(
      {
        user_id: userId,
        memory_id_a: row.id,        // prior (older)
        memory_id_b: newMemoryId,   // new
        entity_name: result.entityName ?? null,
        quote_a: result.quoteA!,
        quote_b: result.quoteB!,
      },
      { onConflict: 'memory_id_a,memory_id_b', ignoreDuplicates: true }
    );
  }
}

// Pull the pre-computed embedding from the memories table to avoid a redundant embed call.
async function getStoredEmbedding(
  sb: SupabaseClient,
  memoryId: string
): Promise<number[]> {
  const { data } = await sb
    .from('memories')
    .select('embedding')
    .eq('id', memoryId)
    .maybeSingle();

  // If no embedding stored yet (shouldn't happen after capture), return zero vector
  if (!data?.embedding) return new Array(1536).fill(0) as number[];
  // Supabase returns vectors as JSON strings or arrays depending on driver version
  if (typeof data.embedding === 'string') {
    return JSON.parse(data.embedding) as number[];
  }
  return data.embedding as number[];
}
