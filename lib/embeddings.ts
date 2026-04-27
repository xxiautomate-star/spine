// Provider-agnostic embedding layer.
//
// v2.0 ships OpenAI as the default and only fully-wired provider. Voyage and
// Cohere stubs exist so callers can declare intent today; they throw a
// recognisable NotImplementedError so it's obvious in logs which provider
// was attempted. v2.1 fills the stubs in.
//
// Provider selection (in order of precedence):
//   1. explicit `provider` arg on embedText / embedMany
//   2. SPINE_EMBED_PROVIDER env var
//   3. 'openai' fallback
//
// All providers emit 1536-dim vectors so they drop into the existing
// pgvector(1536) column without an index rebuild. The dim invariant is
// enforced at runtime for safety.

const DEFAULT_PROVIDER: EmbedProvider = 'openai';
export const EMBED_DIMS = 1536;

export type EmbedProvider = 'openai' | 'voyage' | 'cohere';

export type EmbedResult = {
  vectors: number[][];
  provider: EmbedProvider;
  model: string;
  dims: number;
};

export class NotImplementedError extends Error {
  constructor(provider: EmbedProvider) {
    super(`Embedding provider "${provider}" is not implemented in v2.0. Use 'openai' or wait for v2.1.`);
    this.name = 'NotImplementedError';
  }
}

function resolveProvider(explicit?: EmbedProvider): EmbedProvider {
  if (explicit) return explicit;
  const env = process.env.SPINE_EMBED_PROVIDER;
  if (env === 'openai' || env === 'voyage' || env === 'cohere') return env;
  return DEFAULT_PROVIDER;
}

export type EmbedOpts = {
  provider?: EmbedProvider;
};

// ─── OpenAI ──────────────────────────────────────────────────────────────────

const OPENAI_MODEL = 'text-embedding-3-small';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';

async function callOpenAI(input: string | string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured on the server.');
  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

// ─── Voyage AI (stub for v2.1) ───────────────────────────────────────────────

async function callVoyage(_input: string | string[]): Promise<number[][]> {
  throw new NotImplementedError('voyage');
}

// ─── Cohere (stub for v2.1) ──────────────────────────────────────────────────

async function callCohere(_input: string | string[]): Promise<number[][]> {
  throw new NotImplementedError('cohere');
}

// ─── Public API ──────────────────────────────────────────────────────────────

function modelFor(provider: EmbedProvider): string {
  switch (provider) {
    case 'openai': return OPENAI_MODEL;
    case 'voyage': return 'voyage-3-large';
    case 'cohere': return 'embed-english-v3.0';
  }
}

async function dispatch(provider: EmbedProvider, input: string | string[]): Promise<number[][]> {
  switch (provider) {
    case 'openai': return callOpenAI(input);
    case 'voyage': return callVoyage(input);
    case 'cohere': return callCohere(input);
  }
}

export async function embedText(text: string, opts?: EmbedOpts): Promise<number[]> {
  const provider = resolveProvider(opts?.provider);
  const [v] = await dispatch(provider, text);
  if (v.length !== EMBED_DIMS) {
    throw new Error(`Embedding dim mismatch: provider ${provider} returned ${v.length}, expected ${EMBED_DIMS}.`);
  }
  return v;
}

export async function embedMany(texts: string[], opts?: EmbedOpts): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = resolveProvider(opts?.provider);
  const vectors = await dispatch(provider, texts);
  for (const v of vectors) {
    if (v.length !== EMBED_DIMS) {
      throw new Error(`Embedding dim mismatch: provider ${provider} returned ${v.length}, expected ${EMBED_DIMS}.`);
    }
  }
  return vectors;
}

// Full-result variant for callers that need to record provenance alongside the
// vector (capture path, reembed scripts).
export async function embedManyWithMeta(texts: string[], opts?: EmbedOpts): Promise<EmbedResult> {
  const provider = resolveProvider(opts?.provider);
  const vectors = await embedMany(texts, opts);
  return { vectors, provider, model: modelFor(provider), dims: EMBED_DIMS };
}

export function defaultProvider(): EmbedProvider {
  return resolveProvider();
}

export function modelForDefault(): string {
  return modelFor(resolveProvider());
}
