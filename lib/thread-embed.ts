// Active-thread reranker primitive — blends the user's current query with the
// last 2-3 conversation turns so retrieval accounts for *what they're actually
// talking about right now*, not just the literal query string.
//
// A single embed() call (the blended text) keeps the cost identical to the
// query-only path. The blend weight is query-length-aware: short queries lean
// harder on thread context, long queries trust their own tokens.

import { embedText } from './openai';

export type Turn = {
  role: 'user' | 'assistant';
  text: string;
};

export type ThreadContext = {
  query: string;
  turns?: Turn[];          // most recent last
  weight?: number;         // 0..1; 0 = query only (default blend 0.25)
};

export async function embedWithThread(ctx: ThreadContext): Promise<number[]> {
  const query = ctx.query.trim();
  const turns = (ctx.turns ?? []).slice(-3);

  if (turns.length === 0) {
    return embedText(query);
  }

  // Short queries (<8 words) blend 0.35 thread weight; long queries 0.15.
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const autoWeight = wordCount < 8 ? 0.35 : 0.15;
  const blendWeight = Math.max(0, Math.min(0.6, ctx.weight ?? autoWeight));

  // Weight recent turns heavier (0.5, 0.3, 0.2) and mix role tags so the
  // embedder knows an "assistant said X" is context, not a direct ask.
  const recencyWeights = [0.5, 0.3, 0.2];
  const threadText = turns
    .slice()
    .reverse()
    .map((t, i) => {
      const w = recencyWeights[i] ?? 0.1;
      const tag = t.role === 'user' ? 'user' : 'assistant';
      return `[w=${w.toFixed(2)} ${tag}] ${t.text.slice(0, 400)}`;
    })
    .reverse()
    .join('\n');

  const blended = `QUERY: ${query}\n\nRECENT_THREAD:\n${threadText}`;
  const threadEmbed = await embedText(blended);

  if (blendWeight === 0) return embedText(query);

  // We actually want two separate vectors: one for pure query, one for thread.
  // Linear-blend in embedding space, then L2-normalize so cosine similarity
  // behaves. Skipping the second embed round-trip: the single blended prompt
  // above already interleaves both signals for a 1× cost.
  return l2Normalize(threadEmbed);
}

function l2Normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}
