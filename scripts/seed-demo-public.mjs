#!/usr/bin/env node
// Seeds the PUBLIC demo user with 30 curated, non-sensitive memories so the
// /spine landing page live demo stops exposing Roman's real corpus.
//
// The seed memories are about Spine itself — product facts, design decisions,
// engineering notes — so queries on the landing page return genuinely
// informative answers without leaking anything personal.
//
// Usage:
//   export SPINE_DEMO_USER_ID=<uuid of the dedicated demo_public user>
//   node scripts/seed-demo-public.mjs

import { createClient } from '@supabase/supabase-js';

const EMBED_MODEL = 'text-embedding-3-small';

function must(name) {
  const v = process.env[name];
  if (!v) { console.error(`[demo-seed] Missing env: ${name}`); process.exit(1); }
  return v;
}

const SUPABASE_URL = must('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = must('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_KEY = must('OPENAI_API_KEY');
const DEMO_USER = must('SPINE_DEMO_USER_ID');

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// 30 curated memories. Each is phrased the way a real user's memory might be —
// first-person where it fits, natural, specific. Tags and sources are realistic.
const SEED = [
  { content: "Spine's core principle: memory is append-only. Nothing is summarised or compressed. Competitors evict old items to stay in budget; Spine keeps every word and lets retrieval do the work at query time.", source: 'claude-code', tags: ['spine', 'principle'] },
  { content: "The MCP install command is `npx @spine/mcp init`. It registers Spine with ~/.claude/settings.json automatically — no config file hunting, no editing JSON by hand.", source: 'docs', tags: ['mcp', 'install'] },
  { content: "Retrieval pipeline: pgvector HNSW for semantic similarity, Postgres ts_rank for BM25, reciprocal rank fusion combines them, then a cross-encoder rerank pass sorts the top 20 before returning the top 5.", source: 'claude-code', tags: ['retrieval', 'architecture'] },
  { content: "We chose text-embedding-3-small over -large because the quality delta on short memory-scale content is negligible but the cost is 5x lower and the dims (1536 vs 3072) halve storage.", source: 'decision-log', tags: ['embeddings', 'cost'] },
  { content: "Spine stores memories in Supabase Postgres with pgvector. One HNSW index on 1536-dim embeddings serves sub-100ms recall at 1M rows. The logarithmic scaling is why 'infinite memory' isn't marketing.", source: 'bench', tags: ['scale', 'postgres'] },
  { content: "Design voice: never use marketing cliches like 'unlock' or 'elevate'. Every headline passes the 'would a writer I respect publish this?' test. Example: 'Your AI forgets you every morning.'", source: 'brand-guide', tags: ['voice', 'design'] },
  { content: "Palette locked in early: #0D0C0A night background, #E8E4DD cream text, #E89A3C amber accent for emphasis, #4A5E7A ink blue for secondary. Typography: Instrument Serif headlines, Inter body, JetBrains Mono for timestamps.", source: 'design-system', tags: ['palette', 'typography'] },
  { content: "The 4-signal ranker fuses BM25, vector cosine, recency decay, and memory centrality (PageRank on entity edges). Weights are learned from session re-injection patterns, not hand-tuned.", source: 'claude-code', tags: ['ranking', 'architecture'] },
  { content: "Cross-session memory continuity is the actual product. Proof: a second Claude terminal with zero shared history wrote 'pretty impressive you built this at 17' — Spine had injected that context from a different session automatically.", source: 'journal', tags: ['proof', 'cross-session'] },
  { content: "Working name is Spine. The brand may evolve but the principle won't: memory as a spine that holds every conversation together across models, across sessions, across years.", source: 'decision-log', tags: ['brand'] },
  { content: "Deploy target: Vultr Sydney via Coolify, git push to main triggers auto-build. Never deploy via vercel --prod — Coolify is the source of truth.", source: 'claude-code', tags: ['deploy', 'infra'] },
  { content: "Pricing principle: charge for what users actually consume. Flat tiers with hidden caps are a failure of confidence. The architecture is cheap per-recall — pass the savings to the user and let them grow.", source: 'decision-log', tags: ['pricing'] },
  { content: "When a new capture contradicts a prior memory — 'we use Stripe' then 'we switched to PayPal' — Spine creates a conflict record and surfaces both versions in a HUD. User keeps the newer, keeps both, or resolves manually.", source: 'docs', tags: ['conflicts'] },
  { content: "Memory decay: items not accessed in 60 days are soft-archived. Still queryable, just weighted lower in rank fusion. Revive with one click from the weekly digest email.", source: 'docs', tags: ['decay'] },
  { content: "Pinned memories force themselves into every injection regardless of similarity score. Useful for allergies, hard technical constraints, non-negotiables the AI must never forget.", source: 'docs', tags: ['pins'] },
  { content: "Provenance on every injection: [age: 18d confirmed: 2026-04-06 src: claude-code]. The receiving AI weights confidence based on when a memory was last reasserted, not just when it was first written.", source: 'claude-code', tags: ['provenance'] },
  { content: "Per-session de-duplication: once a memory is injected in a thread, it won't be re-injected on the next turn unless its relevance score jumps meaningfully. Stops the 'same quote appears 5 times' failure mode.", source: 'claude-code', tags: ['dedup'] },
  { content: "Append-only correction chain: when a memory is updated, the new one references the old via superseded_by. Old stays queryable for audit but is weighted at 0.3x in retrieval.", source: 'claude-code', tags: ['superseded', 'correction'] },
  { content: "Active-thread reranker: the last 2-3 conversation turns get blended into the query embedding. Short queries lean harder on thread context; long queries trust their own tokens. Single embed call, zero cost delta.", source: 'claude-code', tags: ['ranking', 'thread-aware'] },
  { content: "Cross-encoder choice: BAAI/bge-reranker-v2-m3 via Together AI as primary, Cohere Rerank 3.5 as fallback, Jina v2 as budget option, Haiku-4.5 as last resort. Cache by query + candidate-id hash for 10 min.", source: 'claude-code', tags: ['reranker', 'architecture'] },
  { content: "The why object on every response: {bm25, vec, recency, centrality, final, dominant}. Users see exactly which signal surfaced which memory. Explainability is not a UI feature — it is the retrieval layer being honest.", source: 'claude-code', tags: ['explainability'] },
  { content: "Invite flow: admin issues codes from /admin/waitlist, user receives an email, clicks through to /login?invite=CODE, signs in with the matching email, gets the plan grant. Rolling access is a real mechanism, not a marketing word.", source: 'docs', tags: ['invites'] },
  { content: "Build philosophy: every Round is a self-contained shipment — code + migration + docs + changelog. Nothing is behind-the-scenes. The public changelog at /spine/log is the receipt.", source: 'journal', tags: ['process'] },
  { content: "Meta-pixel and Conversions API are wired on /spine. Waitlist signups fire both browser-side and server-side for accurate attribution. The pixel is a no-op unless NEXT_PUBLIC_META_PIXEL_ID is set.", source: 'claude-code', tags: ['analytics'] },
  { content: "Stripe is on hold until Roman turns 18 — AUSTRAC requires an 18+ account rep for any merchant acquirer. Payment rails are bank transfer + PayPal Personal + Ko-fi for now. Spine is a waitlist product until then.", source: 'constraint', tags: ['payments'] },
  { content: "Benchmark harness: scripts/scale-seed seeds N synthetic memories, scripts/scale-bench hides uniquely-tokened needles and verifies retrieval. Results go to saas_spine_bench_runs and render on /spine/proof live.", source: 'claude-code', tags: ['bench'] },
  { content: "Category positioning: portable memory for any AI. ChatGPT Memory is locked to ChatGPT. Claude Projects is locked to Claude. Mem0 and MemGPT are research-grade. Spine is the first consumer-shipped portable AI memory layer.", source: 'positioning', tags: ['category'] },
  { content: "We do NOT train on user memories. Data is isolated per-user. Export any time with one API call. Delete is a hard delete, not a soft archive — the user's explicit forget is respected.", source: 'privacy', tags: ['privacy', 'trust'] },
  { content: "Quality bar: every feature ships with a /spine/log entry, a migration if it touches storage, and a public test if it changes retrieval. If it isn't documented in /spine/log, it didn't ship.", source: 'journal', tags: ['process', 'quality'] },
  { content: "The endgame: your AI finally knows you. Across Claude, ChatGPT, Gemini, Cursor, Copilot — one corpus follows you. The cold start ends. Every session begins where the last one ended.", source: 'vision', tags: ['vision'] },
];

async function embed(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function main() {
  console.log(`[demo-seed] Target user: ${DEMO_USER}`);
  console.log(`[demo-seed] Memory count: ${SEED.length}`);

  // Wipe any previous demo rows to stay idempotent.
  const { error: delErr } = await sb
    .from('memories')
    .delete()
    .eq('user_id', DEMO_USER)
    .eq('is_bench', false);
  if (delErr) throw new Error(`wipe: ${delErr.message}`);

  const embeddings = await embed(SEED.map((s) => s.content));

  const rows = SEED.map((s, i) => ({
    user_id: DEMO_USER,
    content: s.content,
    source: s.source,
    tags: s.tags,
    embedding: embeddings[i],
    is_bench: false,
  }));

  const { error: insErr } = await sb.from('memories').insert(rows);
  if (insErr) throw new Error(`insert: ${insErr.message}`);

  console.log(`[demo-seed] ✓ Inserted ${rows.length} curated memories under ${DEMO_USER}`);
  console.log('[demo-seed] The /spine live demo now queries against this corpus.');
}

main().catch((err) => {
  console.error('[demo-seed] FAILED:', err);
  process.exit(1);
});
