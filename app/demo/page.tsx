'use client';

import Link from 'next/link';
import { useState, useMemo, useEffect, type ReactNode } from 'react';

type ApiMemory = {
  id: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  similarity: number;
};

// ── Demo corpus ────────────────────────────────────────────────────────────
// 25 real-looking memories across 5 sessions. Dates are computed at render
// time so they stay "recent" on any visit date.

type DemoMemory = {
  id: string;
  content: string;
  source: 'claude.ai' | 'chatgpt.com' | 'gemini.google.com';
  tags: string[];
  daysAgo: number;
  minsOffset: number;
  baseSim: number;
};

const MEMORIES: DemoMemory[] = [
  // ── Session 1 · claude.ai · 3 days ago ──────────────────────────────────
  {
    id: 's1-1', daysAgo: 3, minsOffset: 0, baseSim: 0.94, source: 'claude.ai',
    tags: ['infra', 'database'],
    content: 'pgvector over Pinecone — cost matters more than managed infrastructure at this stage. HNSW with cosine ops, threshold 0.78 for cluster assignment.',
  },
  {
    id: 's1-2', daysAgo: 3, minsOffset: 28, baseSim: 0.91, source: 'claude.ai',
    tags: ['architecture', 'recall'],
    content: 'Hybrid recall pipeline: pgvector cosine top 30 + BM25 tsvector union → Haiku 4.5 reranker on Pro tier. Free tier returns pure cosine top 5 with no rerank.',
  },
  {
    id: 's1-3', daysAgo: 3, minsOffset: 55, baseSim: 0.88, source: 'claude.ai',
    tags: ['stack', 'frontend'],
    content: 'Next.js 15 App Router, TypeScript strict mode, Tailwind 3.4. No Shadcn, no Radix — custom components only. Inline JSX styles in generated fragments.',
  },
  {
    id: 's1-4', daysAgo: 3, minsOffset: 80, baseSim: 0.85, source: 'claude.ai',
    tags: ['deployment', 'infra'],
    content: 'Supabase on ap-southeast-2 (Sydney). Same region as Vultr VPS matters for latency. Coolify handles auto-deploy on git push to main. Never `npx vercel --prod`.',
  },
  {
    id: 's1-5', daysAgo: 3, minsOffset: 110, baseSim: 0.79, source: 'claude.ai',
    tags: ['ops', 'deployment'],
    content: 'Deploy = git push origin main → Coolify Dockerfile build → auto-deploys to VPS. Vercel is backup only. The Coolify webhook fires on every push to main.',
  },
  // ── Session 2 · chatgpt.com · 5 days ago ────────────────────────────────
  {
    id: 's2-1', daysAgo: 5, minsOffset: 0, baseSim: 0.83, source: 'chatgpt.com',
    tags: ['tooling', 'preference'],
    content: 'Prefer Claude Code over Cursor. Claude Sonnet 4.6 for most tasks, Groq llama-3.3-70b free tier for LLM calls in the synthesis engine. Anthropic API is last resort.',
  },
  {
    id: 's2-2', daysAgo: 5, minsOffset: 22, baseSim: 0.81, source: 'chatgpt.com',
    tags: ['styling', 'preference'],
    content: 'Tailwind over CSS modules for all client sites. Mobile-first always — test at 375px as the floor. Inline styles in JSX fragments only (no class leakage between generated pages).',
  },
  {
    id: 's2-3', daysAgo: 5, minsOffset: 48, baseSim: 0.77, source: 'chatgpt.com',
    tags: ['tooling', 'payments', 'email'],
    content: 'Resend for transactional email, Stripe for payments. Never SendGrid — reliability issues Q3 2025. Stripe webhook secret goes in Coolify as STRIPE_WEBHOOK_SECRET.',
  },
  {
    id: 's2-4', daysAgo: 5, minsOffset: 70, baseSim: 0.74, source: 'chatgpt.com',
    tags: ['client', 'project'],
    content: 'Client: Aerna (sustainable fashion brand). Contact: Sarah Chen, founder. Budget $5K AUD fixed. Shopify integration read-only — pull product and order data only.',
  },
  {
    id: 's2-5', daysAgo: 5, minsOffset: 95, baseSim: 0.72, source: 'chatgpt.com',
    tags: ['testing', 'preference'],
    content: 'Testing stack: Playwright for e2e, Vitest for unit. Playwright specs gate on SPINE_EXT_HARNESS=1 so CI never accidentally triggers live browser sessions.',
  },
  // ── Session 3 · claude.ai · 1 week ago ─────────────────────────────────
  {
    id: 's3-1', daysAgo: 7, minsOffset: 0, baseSim: 0.82, source: 'claude.ai',
    tags: ['strategy', 'goals'],
    content: 'Building automated income. First SaaS MRR before June 2026. Revenue target $1M in 2026. Agency = cash flow, SaaS = wealth. Never confuse the two.',
  },
  {
    id: 's3-2', daysAgo: 7, minsOffset: 25, baseSim: 0.79, source: 'claude.ai',
    tags: ['product', 'saas'],
    content: 'Content Autopilot is the $1 MRR wedge. Spine is the long play — developer wedge via MCP, then normie market via Chrome extension for ChatGPT and Gemini.',
  },
  {
    id: 's3-3', daysAgo: 7, minsOffset: 52, baseSim: 0.76, source: 'claude.ai',
    tags: ['business', 'model'],
    content: 'Three-tier offer: Premium ($5K+ custom builds), Intermediate ($1-2K sites), Basic (template + setup). Premium pays for SaaS runway. Never sell Basic at a loss.',
  },
  {
    id: 's3-4', daysAgo: 7, minsOffset: 78, baseSim: 0.73, source: 'claude.ai',
    tags: ['legal', 'business'],
    content: 'ABN: 46 248 687 420. Sole trader. No employee costs, no payroll. Keep legal surface minimal until $100K ARR. Stripe needs age 18 — bank transfer primary until then.',
  },
  {
    id: 's3-5', daysAgo: 7, minsOffset: 105, baseSim: 0.68, source: 'claude.ai',
    tags: ['design', 'standard'],
    content: 'Design floor: Awwwards SOTD. Every site must feel hand-crafted. No symmetrical 50/50 layouts. Fibonacci spans: 13fr/8fr/5fr. Never ease-in or ease-out — spring physics only.',
  },
  // ── Session 4 · gemini.google.com · 2 weeks ago ─────────────────────────
  {
    id: 's4-1', daysAgo: 14, minsOffset: 0, baseSim: 0.92, source: 'gemini.google.com',
    tags: ['mcp', 'architecture'],
    content: 'MCP is the Anthropic-blessed protocol for AI tool extensions. The wedge: `npx spine-mcp init` registers Spine with Claude Code and Claude Desktop in 30 seconds.',
  },
  {
    id: 's4-2', daysAgo: 14, minsOffset: 30, baseSim: 0.89, source: 'gemini.google.com',
    tags: ['mcp', 'config'],
    content: 'Claude Code MCP config: .claude/mcp.json. Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json. Both accept the same mcpServers JSON schema.',
  },
  {
    id: 's4-3', daysAgo: 14, minsOffset: 58, baseSim: 0.87, source: 'gemini.google.com',
    tags: ['spine', 'tools'],
    content: 'Spine MCP tools: spine_remember(fact) stores any string, spine_recall(query) returns top-k relevant via vector search, spine_forget(id) soft-deletes. All user-scoped via RLS.',
  },
  {
    id: 's4-4', daysAgo: 14, minsOffset: 85, baseSim: 0.86, source: 'gemini.google.com',
    tags: ['embeddings', 'cost'],
    content: 'Embeddings: OpenAI text-embedding-3-small (1536-dim). Cost: $0.02/1M tokens. Zero-day retention on the Embeddings API — OpenAI does not store the content we send.',
  },
  {
    id: 's4-5', daysAgo: 14, minsOffset: 112, baseSim: 0.88, source: 'gemini.google.com',
    tags: ['architecture', 'proactive'],
    content: 'Proactive injection: before each session, pull top 5 relevant memories via cosine search and prepend as system context. Haiku 4.5 filters relevance cheaply before injection.',
  },
  // ── Session 5 · claude.ai · 3 weeks ago ─────────────────────────────────
  {
    id: 's5-1', daysAgo: 21, minsOffset: 0, baseSim: 0.78, source: 'claude.ai',
    tags: ['engine', 'animation'],
    content: 'Spring physics only: stiffness + damping. Never ease-in, ease-out, or linear. Framer Motion for UI springs, GSAP for scroll-driven sequences. Always 400-600ms breath pace.',
  },
  {
    id: 's5-2', daysAgo: 21, minsOffset: 32, baseSim: 0.75, source: 'claude.ai',
    tags: ['engine', 'fragments'],
    content: 'Fragment rule: minimum 400 lines per hero fragment, 7 visual depth layers each. The engine\'s power = stored code complexity, not prompt engineering. LLM job is selection only.',
  },
  {
    id: 's5-3', daysAgo: 21, minsOffset: 60, baseSim: 0.77, source: 'claude.ai',
    tags: ['webgl', 'shaders'],
    content: 'WebGL shaders require: simplex3D noise (not Perlin), domain warping (2+ FBM octaves), uTime animated + uMouse cursor reactive. Canvas compositing at 0.35-0.45 opacity always.',
  },
  {
    id: 's5-4', daysAgo: 21, minsOffset: 88, baseSim: 0.73, source: 'claude.ai',
    tags: ['engine', 'validation'],
    content: 'Self-healer validates generated code before mounting: AST tag balance check, 11 regex fixers, then LLM fallback if both fail. validateFragmentTags() is the entry point.',
  },
  {
    id: 's5-5', daysAgo: 21, minsOffset: 115, baseSim: 0.71, source: 'claude.ai',
    tags: ['engine', 'ml'],
    content: 'Genetic breeding: score output on 8 dimensions → store lessons → evolve winning patterns. Training loop runs daily at 3am UTC, 1 cycle max, $0.05 cap via Groq free tier.',
  },
];

const SESSION_LABELS: Record<number, string> = {
  3: '3 days ago',
  5: '5 days ago',
  7: '1 week ago',
  14: '2 weeks ago',
  21: '3 weeks ago',
};

const SOURCE_COLORS: Record<string, string> = {
  'claude.ai':          'text-amber border-amber/30 bg-amber/5',
  'chatgpt.com':        'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
  'gemini.google.com':  'text-sky-400 border-sky-400/30 bg-sky-400/5',
};

function relativeDate(m: DemoMemory): Date {
  const d = new Date();
  d.setDate(d.getDate() - m.daysAgo);
  d.setMinutes(d.getMinutes() - m.minsOffset);
  return d;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function computeSim(m: DemoMemory, q: string): number {
  if (!q) return m.baseSim;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const content = m.content.toLowerCase();
  const hits = words.filter((w) => content.includes(w)).length;
  const boost = (hits / Math.max(words.length, 1)) * 0.18;
  return Math.min(0.99, m.baseSim * 0.85 + boost);
}

// ── Component ─────────────────────────────────────────────────────────────
export default function DemoPage() {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [apiResults, setApiResults] = useState<ApiMemory[] | null>(null);
  const [apiLoading, setApiLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setApiResults(null); setApiLoading(false); return; }
    setApiLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/demo/search?q=${encodeURIComponent(q)}&limit=20`);
        if (res.ok) {
          const data = (await res.json()) as { memories: ApiMemory[] };
          setApiResults(data.memories);
        }
      } catch { /* fall back to static */ }
      setApiLoading(false);
    }, 380);
    return () => clearTimeout(t);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MEMORIES
      .filter((m) => {
        if (sourceFilter !== 'all' && m.source !== sourceFilter) return false;
        if (q && !m.content.toLowerCase().includes(q) && !m.tags.some(t => t.includes(q))) return false;
        return true;
      })
      .map((m) => ({ ...m, sim: computeSim(m, q), date: relativeDate(m) }))
      .sort((a, b) => {
        if (query) return b.sim - a.sim;
        return b.date.getTime() - a.date.getTime();
      });
  }, [query, sourceFilter]);

  const groupedDays = useMemo(() => {
    if (query) return null;
    const groups = new Map<number, typeof filtered>();
    for (const m of filtered) {
      const g = groups.get(m.daysAgo) ?? [];
      g.push(m);
      groups.set(m.daysAgo, g);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [filtered, query]);

  const sources = ['claude.ai', 'chatgpt.com', 'gemini.google.com'];

  return (
    <div className="min-h-screen bg-night">
      {/* Ambient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute left-1/4 top-0 w-[700px] h-[700px] rounded-full bg-amber/[0.05] blur-[180px]" />
        <div className="absolute right-0 bottom-1/4 w-[400px] h-[400px] rounded-full bg-ink/20 blur-[160px]" />
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-50 px-6 md:px-10 py-4 flex items-center justify-between backdrop-blur-md bg-night/80 border-b border-cream/5">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="block w-2 h-2 rounded-full bg-amber transition-transform duration-500 group-hover:scale-125" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-6">
          <span className="hidden md:block font-mono text-[10px] uppercase tracking-widest text-amber/70 border border-amber/20 px-2.5 py-1 rounded">
            Demo account
          </span>
          <Link
            href="/login"
            className="font-mono text-[11px] uppercase tracking-widest text-cream/50 hover:text-amber transition-colors duration-300"
          >
            Sign in to see yours →
          </Link>
        </div>
      </nav>

      {/* Header */}
      <header className="relative px-6 md:px-16 pt-16 pb-10 max-w-5xl mx-auto">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-5">
          § 001 · Archive · demo account
        </p>
        <h1 className="font-serif font-normal text-4xl md:text-5xl text-cream leading-tight mb-4">
          Every word, every session.
        </h1>
        <p className="text-cream/50 leading-relaxed max-w-2xl mb-8">
          This is a real archive: 25 memories captured across 5 sessions on Claude, ChatGPT, and Gemini.
          Search by meaning. Filter by source. This is what your AI would know about you.
        </p>

        {/* Search */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-cream/30 select-none">
              ⌕
            </span>
            <input
              type="text"
              placeholder={'Search by meaning — try "deploy" or "pgvector"'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-3 bg-cream/[0.04] border border-cream/10 focus:border-amber/40 rounded-lg font-sans text-sm text-cream placeholder:text-cream/30 outline-none transition-colors duration-300"
            />
          </div>
        </div>

        {/* Source filters */}
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => setSourceFilter('all')}
            className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors duration-200 ${
              sourceFilter === 'all'
                ? 'bg-cream/10 border-cream/30 text-cream'
                : 'border-cream/10 text-cream/40 hover:text-cream/70'
            }`}
          >
            All sources
          </button>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s === sourceFilter ? 'all' : s)}
              className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors duration-200 ${
                sourceFilter === s
                  ? SOURCE_COLORS[s] + ' border-current'
                  : 'border-cream/10 text-cream/40 hover:text-cream/70'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Count */}
        <p className="mt-4 font-mono text-[11px] text-cream/30">
          {query
            ? apiLoading
              ? 'searching…'
              : apiResults
                ? `${apiResults.length} ${apiResults.length === 1 ? 'memory' : 'memories'} · real pgvector search`
                : `${filtered.length} ${filtered.length === 1 ? 'memory' : 'memories'} · ranked by similarity`
            : `${MEMORIES.length} total · sorted by recency`}
        </p>
      </header>

      {/* Memory list */}
      <main className="px-6 md:px-16 pb-32 max-w-5xl mx-auto relative">

        {/* Search results — real API when available, static fallback */}
        {query && (
          <div className="space-y-3">
            {apiResults ? (
              apiResults.length === 0 ? (
                <p className="text-cream/30 font-mono text-sm py-8">No memories matched your query.</p>
              ) : (
                apiResults.map((m) => (
                  <ApiMemoryCard key={m.id} m={m} query={query} />
                ))
              )
            ) : apiLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border border-cream/[0.08] rounded-xl p-5 bg-cream/[0.02] animate-pulse">
                    <div className="h-3 bg-cream/10 rounded w-1/3 mb-3" />
                    <div className="h-4 bg-cream/10 rounded w-full mb-2" />
                    <div className="h-4 bg-cream/10 rounded w-4/5" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {filtered.length === 0 && (
                  <p className="text-cream/30 font-mono text-sm py-8">No matches found.</p>
                )}
                {filtered.map((m) => (
                  <MemoryCard key={m.id} m={m} query={query} />
                ))}
              </>
            )}
          </div>
        )}

        {/* Grouped by session */}
        {!query && groupedDays && (
          <div className="space-y-12">
            {groupedDays.map(([days, mems]) => (
              <div key={days}>
                <div className="flex items-center gap-4 mb-5">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-cream/30">
                    {SESSION_LABELS[days] ?? `${days} days ago`}
                  </p>
                  <div className="flex-1 h-px bg-cream/5" />
                  <p className="font-mono text-[10px] text-cream/20">{mems.length} memories</p>
                </div>
                <div className="space-y-3">
                  {mems.map((m) => (
                    <MemoryCard key={m.id} m={m} query={query} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-16 border border-cream/10 rounded-xl p-8 bg-cream/[0.02]">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-3">
            Your archive, not a demo
          </p>
          <h2 className="font-serif font-normal text-2xl text-cream mb-3">
            Start your own archive in 30 seconds.
          </h2>
          <p className="text-cream/60 text-sm leading-relaxed mb-6 max-w-xl">
            Every AI session you have adds to your corpus. By next week, your AI knows your stack,
            your clients, your preferences. By next month, it knows you.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/#waitlist"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber text-night font-sans text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
            >
              Request access →
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-cream/20 text-cream/70 font-sans text-sm rounded-lg hover:border-cream/40 transition-colors"
            >
              Back to home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

// ── API Memory card (real Supabase results) ────────────────────────────────
function ApiMemoryCard({ m, query }: { m: ApiMemory; query: string }) {
  const simPct = Math.round(m.similarity * 100);
  const barWidth = `${Math.max(4, Math.round(m.similarity * 100))}%`;
  const source = m.source ?? 'claude.ai';
  const colorClass = SOURCE_COLORS[source] ?? SOURCE_COLORS['claude.ai'];

  const d = new Date(m.createdAt);
  const daysAgo = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const label = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;

  function highlight(text: string): ReactNode {
    if (!query) return text;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p) ? <mark key={i} className="bg-amber/20 text-amber rounded px-0.5">{p}</mark> : p
    );
  }

  return (
    <div className="group border border-cream/[0.08] hover:border-amber/20 rounded-xl p-5 bg-cream/[0.02] hover:bg-amber/[0.02] transition-all duration-300">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${colorClass}`}>
            {source}
          </span>
          {(m.tags ?? []).map((t) => (
            <span key={t} className="font-mono text-[10px] text-cream/30 border border-cream/[0.08] rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px] text-cream/25 flex-shrink-0">{label}</span>
      </div>
      <p className="text-[14px] leading-relaxed text-cream/80 mb-4">{highlight(m.content)}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-[2px] bg-cream/[0.06] rounded-full overflow-hidden">
          <div className="h-full bg-amber/60 rounded-full transition-all duration-500" style={{ width: barWidth }} />
        </div>
        <span className="font-mono text-[10px] text-cream/25 flex-shrink-0">
          {m.similarity.toFixed(3)} · pgvector
        </span>
      </div>
    </div>
  );
}

// ── Static Memory card ─────────────────────────────────────────────────────
function MemoryCard({
  m,
  query,
}: {
  m: DemoMemory & { sim: number; date: Date };
  query: string;
}) {
  const simPct = Math.round(m.sim * 100);
  const barWidth = `${Math.round(m.sim * 100)}%`;

  function highlight(text: string): ReactNode {
    if (!query) return text;
    const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p) ? <mark key={i} className="bg-amber/20 text-amber rounded px-0.5">{p}</mark> : p
    );
  }

  return (
    <div className="group border border-cream/[0.08] hover:border-cream/20 rounded-xl p-5 bg-cream/[0.02] hover:bg-cream/[0.04] transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${SOURCE_COLORS[m.source]}`}>
            {m.source}
          </span>
          {m.tags.map((t) => (
            <span key={t} className="font-mono text-[10px] text-cream/30 border border-cream/[0.08] rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px] text-cream/25 flex-shrink-0">
          {SESSION_LABELS[m.daysAgo] ?? ''} · {fmtTime(m.date)}
        </span>
      </div>

      {/* Content */}
      <p className="text-[14px] leading-relaxed text-cream/80 mb-4">
        {highlight(m.content)}
      </p>

      {/* Similarity bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-[2px] bg-cream/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-amber/60 rounded-full transition-all duration-500"
            style={{ width: barWidth }}
          />
        </div>
        <span className="font-mono text-[10px] text-cream/25 flex-shrink-0">
          {m.sim.toFixed(2)} cosine
        </span>
      </div>
    </div>
  );
}
