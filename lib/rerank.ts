// Haiku-4.5 reranker. Given a query + candidate memories, picks the top-N with
// a short reason. System prompt is cacheable so repeat calls drop to ~$0.10/MTok.

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// Per-MTok Haiku-4.5 pricing (USD).
const PRICE_INPUT = 1.0;
const PRICE_OUTPUT = 5.0;
const PRICE_CACHE_WRITE = 1.25;
const PRICE_CACHE_READ = 0.1;

const SYSTEM = `You are the relevance reranker for Spine, a persistent memory layer for AI assistants.

Input: a user's current query + 30 candidate memories retrieved by hybrid vector + BM25 search.
Job: pick the memories most worth injecting into the AI's next response.

Relevance means: answers the query, or gives context the AI would want (user preferences, ongoing work, constraints, past decisions). Prefer specific facts over generic statements. Prefer recent over stale when content overlaps.

Output STRICT JSON with this exact shape and NOTHING ELSE:
{"picks":[{"id":"<uuid from candidate>","score":<0..1>,"reason":"<one short sentence>"}]}

No prose before or after. No markdown. No code fences. UUIDs must match the ids in the input list exactly.`;

export type RerankPick = {
  id: string;
  score: number;
  reason: string;
};

export type RerankResult = {
  picks: RerankPick[];
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  latencyMs: number;
  rawText: string;
};

export type RerankCandidate = {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
};

function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  opts: { limit?: number } = {}
): Promise<RerankResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured on the server.');
  const limit = Math.max(1, Math.min(10, opts.limit ?? 5));

  const list = candidates
    .slice(0, 30)
    .map((c) => {
      const date = c.createdAt.slice(0, 10);
      const src = c.source ? ` [${c.source}]` : '';
      return `- id=${c.id} date=${date}${src} content="${truncate(c.content)}"`;
    })
    .join('\n');

  const userMsg = `Query: ${query}\n\nCandidates:\n${list}\n\nReturn JSON with the top ${limit}.`;

  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 400)}`);
  }

  type Usage = {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    usage: Usage;
  };

  const text = data.content.find((b) => b.type === 'text')?.text ?? '';
  let picks: RerankPick[] = [];
  try {
    const parsed = JSON.parse(stripFences(text)) as { picks?: RerankPick[] };
    if (Array.isArray(parsed.picks)) {
      const ids = new Set(candidates.map((c) => c.id));
      picks = parsed.picks
        .filter((p) => p && typeof p.id === 'string' && ids.has(p.id))
        .map((p) => ({
          id: p.id,
          score: typeof p.score === 'number' ? Math.max(0, Math.min(1, p.score)) : 0,
          reason: typeof p.reason === 'string' ? p.reason.slice(0, 200) : '',
        }))
        .slice(0, limit);
    }
  } catch {
    picks = [];
  }

  const usage = data.usage;
  const inp = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const cwrite = usage.cache_creation_input_tokens ?? 0;
  const cread = usage.cache_read_input_tokens ?? 0;
  const cost =
    (inp / 1e6) * PRICE_INPUT +
    (out / 1e6) * PRICE_OUTPUT +
    (cwrite / 1e6) * PRICE_CACHE_WRITE +
    (cread / 1e6) * PRICE_CACHE_READ;

  return {
    picks,
    cost,
    inputTokens: inp,
    outputTokens: out,
    cacheReadTokens: cread,
    cacheWriteTokens: cwrite,
    latencyMs,
    rawText: text,
  };
}
