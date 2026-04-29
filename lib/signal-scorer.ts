// Signal-quality scoring for capture-time memory tiering.
//
// Every text capture runs through this scorer before storage. The score
// decides three things:
//   1. Whether to embed (low → no embedding, no semantic search)
//   2. Whether to count toward the plan cap (low → free)
//   3. How prominent the row is in dashboard surfaces
//
// Append-only is preserved. Low-signal rows are still stored forever and
// recallable via the timeline. They just don't pollute semantic recall.
//
// Default behavior on outage: every item scores `standard` (score = 0.5).
// Never blocks a capture — Spine writing first, scoring as decoration.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

// Per-call cap on input chars to keep latency + cost bounded. A typical
// capture is 50–500 chars; this only kicks in on very long pasted blobs.
const PER_ITEM_CHAR_CAP = 4000;

// Concurrency cap: if a single batch exceeds 25 items, split into chunks
// of 25 and run the chunks sequentially. Single-call sweet spot for Haiku
// is ~25 items by output-token budget.
const MAX_BATCH_ITEMS = 25;

export type SignalTier = 'high' | 'standard' | 'low';

export type SignalScore = {
  score: number;       // 0.00–1.00
  tier: SignalTier;
  reason: string;      // ≤80-char one-liner
};

const FALLBACK: SignalScore = {
  score: 0.5,
  tier: 'standard',
  reason: 'scorer unavailable — defaulted to standard',
};

const SYSTEM = `You score memory candidates for signal quality in an append-only AI memory system.

Each memory is one fact, decision, observation, or piece of conversation chatter. Your job: rate how worth-remembering it is on a 0.00–1.00 scale, then explain why in ≤80 chars.

SCALE
- 0.00–0.40 (low): chatter, error reactions, status updates without resolution, single-word reactions, pure tool output, ephemeral state ("trying X now"). Stored forever but never search-indexed. The user does NOT want this surfacing in semantic recall.
- 0.40–0.70 (standard): observations, time-bound notes ("meeting at 3pm"), ambient context, events in progress, fragments of bigger ideas. Current default.
- 0.70–1.00 (high signal): stable facts ("we use Postgres"), decisions ("locked Coolify over Vercel"), preferences ("user prefers PowerShell"), architecture choices, identity attributes, anything worth remembering NEXT YEAR.

EDGE CASES
- Numbered lists of decisions → high (preserve all of them)
- Long pastes (>2000 chars): score the whole thing as one tier; usually standard or high
- Pure code snippets without context → standard (low signal alone, but might pair with future captures)
- "We tried X" with no outcome → low (no resolution = no signal yet)
- "We chose X because Y" → high (resolution present)
- Test data, lorem ipsum, single-emoji reactions → low

OUTPUT FORMAT
Return STRICT JSON ONLY. No prose, no markdown, no code fences. An array, one entry per input item, in input order:

[
  {"score": 0.00, "reason": "..."},
  {"score": 0.00, "reason": "..."}
]

The reason must be ≤80 characters and explain the score in a way a developer reading their dashboard would understand.`;

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function tierOf(score: number): SignalTier {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'standard';
  return 'low';
}

function clampScore(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
}

function clampReason(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s.length === 0) return 'no reason returned';
  return s.length > 80 ? s.slice(0, 79) + '…' : s;
}

async function scoreChunk(contents: string[]): Promise<SignalScore[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return contents.map(() => FALLBACK);

  const numbered = contents
    .map((c, i) => {
      const truncated = c.length > PER_ITEM_CHAR_CAP ? c.slice(0, PER_ITEM_CHAR_CAP - 1) + '…' : c;
      return `[${i + 1}] ${truncated}`;
    })
    .join('\n\n---\n\n');

  const userMsg = `Score these ${contents.length} memory candidates. Return a JSON array of ${contents.length} objects in the same order.\n\n${numbered}`;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(contents.length * 80 + 80, 4000),
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
  } catch {
    return contents.map(() => FALLBACK);
  }

  if (!res.ok) {
    return contents.map(() => FALLBACK);
  }

  let parsed: Array<{ score?: unknown; reason?: unknown }> = [];
  try {
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '[]';
    const json = JSON.parse(stripFences(text)) as unknown;
    if (Array.isArray(json)) parsed = json as Array<{ score?: unknown; reason?: unknown }>;
  } catch {
    return contents.map(() => FALLBACK);
  }

  // If the model returned the wrong shape or wrong length, fall back per-item.
  if (parsed.length !== contents.length) return contents.map(() => FALLBACK);

  return parsed.map((p) => {
    const score = clampScore(p.score);
    return {
      score,
      tier: tierOf(score),
      reason: clampReason(p.reason),
    };
  });
}

export async function scoreSignals(contents: string[]): Promise<SignalScore[]> {
  if (contents.length === 0) return [];

  // Single chunk fast path — most captures are 1 item.
  if (contents.length <= MAX_BATCH_ITEMS) {
    return scoreChunk(contents);
  }

  // Batch larger inputs into MAX_BATCH_ITEMS-sized chunks. Sequential
  // (not parallel) — avoid hammering Haiku's per-account rate limit on a
  // single user's bulk import.
  const out: SignalScore[] = [];
  for (let i = 0; i < contents.length; i += MAX_BATCH_ITEMS) {
    const chunk = contents.slice(i, i + MAX_BATCH_ITEMS);
    const scored = await scoreChunk(chunk);
    out.push(...scored);
  }
  return out;
}

// Static helpers exposed for callers that want to apply override logic
// (kind=turn → low, kind=digest → high, non-text → standard) before or
// after the scorer call.

export function tierFromScore(score: number): SignalTier {
  return tierOf(score);
}

export function fallbackScore(reason: string = 'override'): SignalScore {
  return { score: 0.5, tier: 'standard', reason: clampReason(reason) };
}
