#!/usr/bin/env -S npx tsx
/**
 * Seed 50 demo memories with real OpenAI embeddings into Supabase.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_SUPABASE_URL  — your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS)
 *   OPENAI_API_KEY            — for text-embedding-3-small
 *   SPINE_DEMO_USER_ID        — UUID of the demo user account in Supabase auth
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts
 *
 * The script is idempotent: it checks for an existing memory with the same
 * content hash before inserting. Re-running is safe.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DEMO_USER_ID = process.env.SPINE_DEMO_USER_ID;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY || !DEMO_USER_ID) {
  console.error('Missing env vars. Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, SPINE_DEMO_USER_ID');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type RawMemory = {
  content: string;
  source: string;
  tags: string[];
  daysAgo: number;
};

const DEMO_MEMORIES: RawMemory[] = [
  // Architecture decisions
  { content: 'Chose pgvector over Pinecone for Spine — cost matters more than managed infra at this stage. HNSW with cosine ops, threshold 0.78 for cluster assignment.', source: 'claude.ai', tags: ['architecture', 'infrastructure', 'vector-search'], daysAgo: 5 },
  { content: 'Hybrid recall pipeline: pgvector cosine top 30 + BM25 tsvector union → Haiku 4.5 reranker on Pro tier. Free tier returns pure cosine top 5 with no rerank.', source: 'claude.ai', tags: ['architecture', 'recall', 'tiers'], daysAgo: 3 },
  { content: 'Decided on append-only memory model — no compression, no summarisation. Vector search + semantic retrieval handle relevance at query time. This is the core differentiation from competitors.', source: 'chatgpt.com', tags: ['product', 'architecture'], daysAgo: 12 },
  { content: 'MCP protocol chosen over custom API because Anthropic officially endorses it. Claude Code users can paste one JSON block and have memory in 30 seconds. No auth flow required for local mode.', source: 'claude.ai', tags: ['architecture', 'mcp', 'ux'], daysAgo: 8 },
  { content: 'Embeddings: text-embedding-3-small at 1536 dims. Costs ~$0.02 per 1M tokens. For 10k daily memories across all users, monthly cost under $1. Decided NOT to use voyage-lite even though cheaper — OpenAI quality is noticeably better on short memories.', source: 'claude.ai', tags: ['embeddings', 'cost', 'openai'], daysAgo: 7 },

  // Product decisions
  { content: 'Pricing locked: Free = 100 memories + 1 integration, Pro $9/mo = unlimited + cross-AI, Power $29/mo = team memory + background agents. Free tier is intentionally generous — conversion happens when users hit the 100 limit and realise how dependent they are.', source: 'chatgpt.com', tags: ['pricing', 'product'], daysAgo: 10 },
  { content: 'ICP: developers using Claude Code or Cursor daily. They already understand MCP, they already feel the cold-start pain. Normie ChatGPT users come later via the Chrome extension.', source: 'claude.ai', tags: ['product', 'icp', 'marketing'], daysAgo: 14 },
  { content: 'Tagline finalised: "Your AI forgets you every morning. We fix that." Simple, emotional, true. No jargon. Resonates with both devs and non-technical power users.', source: 'claude.ai', tags: ['brand', 'copy'], daysAgo: 11 },
  { content: 'Chrome extension approach: capture conversation turns on chatgpt.com / gemini.google.com via content script. Extract facts, send to Spine API, inject top memories as system prompt prefix on next new conversation.', source: 'chatgpt.com', tags: ['extension', 'architecture'], daysAgo: 6 },
  { content: 'Memory clusters for deduplication: cluster centroid shifts when new memory is within threshold 0.78 cosine similarity. Show user a "merged X similar memories" badge. Keeps the archive clean without losing data.', source: 'claude.ai', tags: ['deduplication', 'architecture'], daysAgo: 4 },

  // Technical implementation
  { content: 'Supabase RLS policy: users can only read/write rows where user_id = auth.uid(). Service role key bypasses RLS for the MCP server capture route. API key maps to user via api_keys table.', source: 'claude.ai', tags: ['security', 'supabase', 'rls'], daysAgo: 9 },
  { content: 'HNSW index params: ef_construction=200, m=16. cosine distance ops. Benchmarked: p95 recall latency 18ms for 100k vectors, 34ms for 1M. Well within 200ms SLA.', source: 'claude.ai', tags: ['performance', 'pgvector', 'hnsw'], daysAgo: 6 },
  { content: 'spine_match_memories RPC uses <-> operator (cosine distance) not <=> (inner product) because our embeddings are NOT normalised by OpenAI. Must normalise or use cosine. Current: cosine, no normalisation.', source: 'claude.ai', tags: ['sql', 'pgvector', 'bug'], daysAgo: 2 },
  { content: 'Context injection block format: XML-tagged memories section prepended to system prompt. Haiku 4.5 filters down to 5 most relevant before injection. Claude naturally integrates these — no special prompting needed.', source: 'claude.ai', tags: ['injection', 'mcp', 'format'], daysAgo: 3 },
  { content: 'Rate limiting on capture endpoint: 100 memories/hour per API key on free tier. 429 response with Retry-After header. Prevents abuse while not blocking legitimate power users.', source: 'claude.ai', tags: ['rate-limiting', 'api'], daysAgo: 7 },

  // Business context
  { content: 'XXIautomate ABN: 46248687420. Sole trader. Business name XXIAUTOMATE pending ASIC review. All invoices must include ABN.', source: 'claude.ai', tags: ['business', 'legal'], daysAgo: 4 },
  { content: 'First revenue target: $1 MRR in 30 days from today. One paying user proves the model. Focus on conversion, not features.', source: 'chatgpt.com', tags: ['business', 'revenue', 'goals'], daysAgo: 1 },
  { content: 'Deploy pipeline: git push main → Coolify auto-builds Dockerfile → deploys to engine.xxiautomate.com. NEVER use vercel prod directly — Vercel is backup only.', source: 'claude.ai', tags: ['deployment', 'infrastructure'], daysAgo: 8 },
  { content: 'Six-terminal stack: Main (Opus 4.7 commander) + AA/Spine/Engine/Leads Engine/Content Autopilot (all Sonnet 4.6). Permanent layout. Each terminal has one product to own.', source: 'claude.ai', tags: ['workflow', 'tooling'], daysAgo: 2 },
  { content: 'Builder\'s Curse audit: 250k lines of code across 6 products, 0 SaaS MRR. Froze 4 products, shipping Spine first to $1 MRR. Revenue wins over feature completeness.', source: 'chatgpt.com', tags: ['strategy', 'audit'], daysAgo: 1 },

  // Previous conversations
  { content: 'Discussed React Server Components vs Client Components tradeoffs for Spine dashboard. Chose: Server for timeline (SEO, no spinner), Client for search + memory editor (real-time UX).', source: 'claude.ai', tags: ['react', 'nextjs', 'architecture'], daysAgo: 5 },
  { content: 'Stripe webhook handling: verify signature with stripe.webhooks.constructEvent(), idempotent via stripe_events table (event_id primary key). Handle customer.subscription.updated to sync plan tier.', source: 'claude.ai', tags: ['stripe', 'webhooks', 'payments'], daysAgo: 9 },
  { content: 'Memory hygiene: stale detection = not retrieved in 90 days. Duplicate detection = cosine similarity > 0.94. Show hygiene score in dashboard. Never auto-delete — always user-confirms.', source: 'claude.ai', tags: ['hygiene', 'product', 'ux'], daysAgo: 3 },
  { content: 'Decided against using LangChain or LlamaIndex — direct Supabase RPC calls are 3x faster and the abstraction adds no value for our specific access patterns. Keep it simple.', source: 'chatgpt.com', tags: ['architecture', 'performance', 'dependencies'], daysAgo: 15 },
  { content: 'Font stack for Spine: Instrument Serif for editorial headlines (memory glow feel), Inter for dashboard UI, JetBrains Mono for timestamps and IDs. Reference: Arc browser, Readwise.', source: 'claude.ai', tags: ['design', 'typography'], daysAgo: 11 },

  // Design decisions
  { content: 'Colour palette locked: night #0D0C0A background, cream #E8E4DD text, amber #E89A3C accent (memory glow). Ink-blue #4A5E7A for secondary. Aesthetic reference: a library at dusk.', source: 'claude.ai', tags: ['design', 'brand', 'colour'], daysAgo: 13 },
  { content: 'Animation philosophy: slow, deliberate, breath-paced. 400-600ms transitions, not 150ms snaps. Memory should feel weighty and permanent, not ephemeral. Reference: Apple Journal app.', source: 'claude.ai', tags: ['design', 'animation', 'ux'], daysAgo: 10 },
  { content: 'Copy voice: reflective, slightly literary. Avoid: "Never forget important details again!". Use: "Your AI forgets you every morning." — speaks to the real pain without hype.', source: 'chatgpt.com', tags: ['copy', 'brand'], daysAgo: 12 },
  { content: 'Timeline view: memories grouped by day, most recent first. Each card shows: content snippet, source icon (Claude/ChatGPT/Gemini), tags, similarity score if in search mode. No pagination — virtual scroll.', source: 'claude.ai', tags: ['dashboard', 'ux', 'design'], daysAgo: 8 },
  { content: 'Mobile-first for everything outside the dashboard. Dashboard can be desktop-primary since target users are developers at a computer. Extension popup = 380px wide, important to keep compact.', source: 'claude.ai', tags: ['mobile', 'ux', 'responsive'], daysAgo: 6 },

  // Technical notes
  { content: 'TypeScript strict mode on for all packages. No any, no ts-ignore without comment. The MCP server especially must be airtight — it runs on users\' machines and any crash kills their Claude session.', source: 'claude.ai', tags: ['typescript', 'quality'], daysAgo: 9 },
  { content: 'better-sqlite3 chosen for local MCP mode (no Supabase). Bundled as a native addon — requires node-gyp on user machine. May switch to sql.js (WASM) to avoid native dependency issues on some machines.', source: 'claude.ai', tags: ['mcp', 'local', 'sqlite'], daysAgo: 7 },
  { content: 'Capture route validates: content must be string, 1-10000 chars. Source must be valid URL or null. Tags: string array, max 10, each max 50 chars. Strict validation prevents garbage in the archive.', source: 'claude.ai', tags: ['api', 'validation', 'capture'], daysAgo: 5 },
  { content: 'Key format: spine_live_{random 24 chars} for production, spine_test_{...} for test mode. Checked at API boundary via constant-time comparison to prevent timing attacks.', source: 'claude.ai', tags: ['security', 'api-keys'], daysAgo: 11 },
  { content: 'Memory export as JSONL (one memory per line) — standard format, easy to import into other tools. Include: id, content, source, tags, created_at, embedding_model. No embeddings in export (too large, can re-embed).', source: 'claude.ai', tags: ['export', 'product', 'data-portability'], daysAgo: 4 },

  // Competitor analysis
  { content: 'Mem.ai: $10/mo, auto-organises into "smart notes", compresses over time. Main weakness: lossy. Users report losing nuance. Our positioning: INFINITE, not summarised.', source: 'chatgpt.com', tags: ['competitors', 'research'], daysAgo: 16 },
  { content: 'MemGPT / Letta: developer-focused, runs locally, complex setup. Our advantage: 30-second cloud install with no local infra. Target different user sophistication level.', source: 'chatgpt.com', tags: ['competitors', 'research'], daysAgo: 14 },
  { content: 'Claude native memory (Projects): limited to project scope, manually managed, no cross-AI. Our advantage: automatic capture across all AI tools, semantic retrieval. Complementary, not competing.', source: 'claude.ai', tags: ['competitors', 'claude', 'research'], daysAgo: 10 },
  { content: 'Notion AI memory: tied to Notion. Requires users to already have all their notes there. We\'re AI-native, not doc-editor-native. Very different workflow integration.', source: 'chatgpt.com', tags: ['competitors', 'research'], daysAgo: 13 },

  // Personal context (demo flavor)
  { content: 'Prefer TypeScript over JavaScript for all server code. Will not write plain JS for production routes anymore after the runtime error that was a simple type mismatch. Type safety is non-negotiable.', source: 'claude.ai', tags: ['preferences', 'typescript'], daysAgo: 20 },
  { content: 'Work style: 6am start, first 2 hours for deep work with no messages. Claude Code session started before coffee. Tasks that need creative decisions = morning, tasks that need execution = afternoon.', source: 'chatgpt.com', tags: ['preferences', 'workflow'], daysAgo: 25 },
  { content: 'Currently reading "The Mom Test" by Rob Fitzpatrick — notes: users lie about what they would pay but tell the truth about past behaviour. Interview question framework matters more than the answers.', source: 'chatgpt.com', tags: ['reading', 'business', 'product'], daysAgo: 18 },
  { content: 'Tech stack preferences: Next.js App Router (not Pages), Supabase (not Firebase — vendor lock-in concern), Tailwind (not CSS-in-JS — too slow on large projects), pnpm (not npm — faster, better deduplication).', source: 'claude.ai', tags: ['preferences', 'stack'], daysAgo: 22 },
  { content: 'Goal: $10k MRR by end of 2026. Spine is the vehicle. After $1k MRR, hire one part-time developer to handle dashboard features so I can focus on growth and product direction.', source: 'chatgpt.com', tags: ['goals', 'business'], daysAgo: 8 },

  // Recent technical work
  { content: 'Fixed pgvector HNSW rebuild after adding 50k vectors — index was not auto-updated after bulk insert via COPY. Must run VACUUM ANALYZE after large batch operations to trigger index refresh.', source: 'claude.ai', tags: ['pgvector', 'bug', 'operations'], daysAgo: 2 },
  { content: 'Playwright test setup for extension: use launchPersistentContext with --load-extension flag. Extension ID extracted from service worker URL. Storage pre-seeded via page.evaluate(chrome.storage.sync.set).', source: 'claude.ai', tags: ['testing', 'playwright', 'extension'], daysAgo: 3 },
  { content: 'CI/CD: GitHub Actions runs on push to main, builds Next.js, runs type check, then triggers Coolify webhook to deploy. Build cache in Actions reduces CI time from 4min to 45s.', source: 'claude.ai', tags: ['ci-cd', 'github-actions', 'deployment'], daysAgo: 6 },
  { content: 'OpenAI embeddings API: zero-data-retention policy for Embeddings API as of 2024. Memories content is sent to OpenAI for embedding but not retained or used for training. Documented in privacy policy.', source: 'chatgpt.com', tags: ['privacy', 'openai', 'legal'], daysAgo: 9 },
  { content: 'Considered Voyage AI for embeddings (voyage-3-lite at 512 dims, much cheaper). Benchmarked recall quality: 8% worse on memory-like short texts vs text-embedding-3-small. Sticking with OpenAI. Re-evaluate at 10M memories/month.', source: 'claude.ai', tags: ['embeddings', 'research', 'cost'], daysAgo: 7 },
  { content: 'Memory lifecycle: captured → embedded (async) → stored → retrievable → retrieved (touch timestamp) → stale (90 days no retrieve) → hygiene flagged. Deletion is always manual.', source: 'claude.ai', tags: ['architecture', 'memory-lifecycle'], daysAgo: 4 },
  { content: 'Context window math: inject top 5 memories × avg 150 tokens = 750 tokens per recall. With Claude 200k context, that\'s 0.375% overhead. Negligible. Could inject 100 memories and still be fine. Current limit is conservative.', source: 'claude.ai', tags: ['performance', 'context-window', 'mcp'], daysAgo: 5 },
];

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function offsetDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(Math.floor(Math.random() * 14) + 7, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

async function main() {
  console.log(`Seeding ${DEMO_MEMORIES.length} demo memories for user ${DEMO_USER_ID}…`);

  // Check existing memories to skip duplicates
  const { data: existing } = await supabase
    .from('memories')
    .select('content')
    .eq('user_id', DEMO_USER_ID);

  const existingHashes = new Set(
    (existing ?? []).map((r: { content: string }) => contentHash(r.content))
  );

  const toInsert = DEMO_MEMORIES.filter(
    (m) => !existingHashes.has(contentHash(m.content))
  );

  if (toInsert.length === 0) {
    console.log('All memories already seeded. Nothing to do.');
    return;
  }

  console.log(`${DEMO_MEMORIES.length - toInsert.length} already exist. Inserting ${toInsert.length} new…`);

  // Embed in batches of 20 (OpenAI limit is 2048 per request, but keep small)
  const BATCH = 20;
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    process.stdout.write(`  Embedding batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(toInsert.length / BATCH)}…`);
    const vecs = await embedBatch(batch.map((m) => m.content));
    allEmbeddings.push(...vecs);
    process.stdout.write(' done\n');
  }

  // Insert into Supabase
  const rows = toInsert.map((m, i) => ({
    user_id: DEMO_USER_ID,
    content: m.content,
    source: m.source,
    tags: m.tags,
    embedding: JSON.stringify(allEmbeddings[i]),
    created_at: offsetDate(m.daysAgo),
    retrieval_count: Math.floor(Math.random() * 8),
    last_retrieved_at: m.daysAgo < 5 ? offsetDate(Math.max(0, m.daysAgo - 1)) : null,
  }));

  const { error } = await supabase.from('memories').insert(rows);
  if (error) {
    console.error('Insert failed:', error.message);
    process.exit(1);
  }

  console.log(`\n✓ Seeded ${toInsert.length} memories successfully.`);
  console.log(`\nNext: set SPINE_DEMO_USER_ID=${DEMO_USER_ID} in your Coolify env vars.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
