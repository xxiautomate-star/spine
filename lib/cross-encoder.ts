// Cross-encoder rerank. Preferred over Haiku for v1.1+: it actually scores
// each candidate against the query jointly in one pass (vs. asking an LLM
// to pick from a list). Cohere Rerank 3 is the managed choice; swap the
// adapter for self-hosted bge-reranker later.
//
// Priority order:
//   1. COHERE_API_KEY set → Cohere Rerank 3 (nimble)
//   2. Jina key set     → Jina Reranker v2 (smaller, faster)
//   3. Fall back to Haiku rerank (existing path).

import { rerank as haikuRerank, type RerankCandidate, type RerankResult } from './rerank';

const COHERE_ENDPOINT = 'https://api.cohere.com/v2/rerank';
const COHERE_MODEL = 'rerank-v3.5';
// Cohere Rerank bills ~$2 / 1000 searches. Input size modestly impacts.
const COHERE_COST_PER_SEARCH_USD = 0.002;

const JINA_ENDPOINT = 'https://api.jina.ai/v1/rerank';
const JINA_MODEL = 'jina-reranker-v2-base-multilingual';
const JINA_COST_PER_SEARCH_USD = 0.0002; // cheaper than Cohere

export type CrossEncoderResult = RerankResult & {
  provider: 'cohere' | 'jina' | 'haiku';
};

function truncate(s: string, max = 512): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

async function cohereRerank(
  query: string,
  candidates: RerankCandidate[],
  limit: number
): Promise<CrossEncoderResult | null> {
  const key = process.env.COHERE_API_KEY;
  if (!key) return null;

  const started = Date.now();
  const res = await fetch(COHERE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: COHERE_MODEL,
      query,
      documents: candidates.map((c) => truncate(c.content)),
      top_n: limit,
    }),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    throw new Error(`Cohere ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };

  const picks = data.results.map((r) => ({
    id: candidates[r.index]?.id ?? '',
    score: Math.max(0, Math.min(1, r.relevance_score)),
    reason: '',
  })).filter((p) => p.id);

  return {
    picks,
    cost: COHERE_COST_PER_SEARCH_USD,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latencyMs,
    rawText: '',
    provider: 'cohere',
  };
}

async function jinaRerank(
  query: string,
  candidates: RerankCandidate[],
  limit: number
): Promise<CrossEncoderResult | null> {
  const key = process.env.JINA_API_KEY;
  if (!key) return null;

  const started = Date.now();
  const res = await fetch(JINA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      query,
      documents: candidates.map((c) => truncate(c.content)),
      top_n: limit,
    }),
  });
  const latencyMs = Date.now() - started;

  if (!res.ok) {
    throw new Error(`Jina ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    results: Array<{ index: number; relevance_score: number }>;
  };

  const picks = data.results.map((r) => ({
    id: candidates[r.index]?.id ?? '',
    score: Math.max(0, Math.min(1, r.relevance_score)),
    reason: '',
  })).filter((p) => p.id);

  return {
    picks,
    cost: JINA_COST_PER_SEARCH_USD,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    latencyMs,
    rawText: '',
    provider: 'jina',
  };
}

export async function crossEncoderRerank(
  query: string,
  candidates: RerankCandidate[],
  opts: { limit?: number } = {}
): Promise<CrossEncoderResult> {
  const limit = Math.max(1, Math.min(10, opts.limit ?? 5));

  if (process.env.COHERE_API_KEY) {
    try {
      const r = await cohereRerank(query, candidates, limit);
      if (r) return r;
    } catch (e) {
      console.warn('[cross-encoder] cohere failed, falling through:', (e as Error).message);
    }
  }

  if (process.env.JINA_API_KEY) {
    try {
      const r = await jinaRerank(query, candidates, limit);
      if (r) return r;
    } catch (e) {
      console.warn('[cross-encoder] jina failed, falling through:', (e as Error).message);
    }
  }

  const haiku = await haikuRerank(query, candidates, { limit });
  return { ...haiku, provider: 'haiku' };
}
