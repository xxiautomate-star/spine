'use client';

import Link from 'next/link';
import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react';

export type MemoryRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
};

type Props = {
  memories: MemoryRow[];
  email: string;
};

// ── Source colour map ──────────────────────────────────────────────────────
const SOURCE_META: Record<string, { label: string; dot: string; text: string }> = {
  'claude.ai':         { label: 'Claude',  dot: 'bg-amber',        text: 'text-amber' },
  'chatgpt.com':       { label: 'ChatGPT', dot: 'bg-emerald-400',  text: 'text-emerald-400' },
  'gemini.google.com': { label: 'Gemini',  dot: 'bg-sky-400',      text: 'text-sky-400' },
};

function sourceMeta(source: string | null) {
  if (!source) return { label: 'Unknown', dot: 'bg-cream/20', text: 'text-cream/30' };
  return SOURCE_META[source] ?? { label: source, dot: 'bg-cream/20', text: 'text-cream/40' };
}

// ── Date helpers ───────────────────────────────────────────────────────────
function parseDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDate(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { month: 'long', day: 'numeric' });
}

function formatWeekday(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'long' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

type DayGroup = { dateKey: string; date: string; weekday: string; memories: MemoryRow[] };

function groupByDay(rows: MemoryRow[]): DayGroup[] {
  const map = new Map<string, MemoryRow[]>();
  for (const m of rows) {
    const k = parseDateKey(m.created_at);
    const g = map.get(k) ?? [];
    g.push(m);
    map.set(k, g);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([k, mems]) => ({ dateKey: k, date: formatDate(k), weekday: formatWeekday(k), memories: mems }));
}

// ── Fake preview corpus (shown blurred behind the empty state) ────────────
const PREVIEW_GROUPS: DayGroup[] = [
  {
    dateKey: '2026-04-17',
    date: 'April 17',
    weekday: 'Thursday',
    memories: [
      { id: 'p1', content: 'pgvector over Pinecone — cost matters more than managed infrastructure at this stage. HNSW with cosine ops, threshold 0.78 for cluster assignment.', source: 'claude.ai', tags: ['infra', 'database'], created_at: '2026-04-17T14:32:00Z' },
      { id: 'p2', content: 'Hybrid recall pipeline: pgvector cosine top 30 + BM25 tsvector union → Haiku 4.5 reranker on Pro tier. Free tier returns pure cosine top 5 with no rerank.', source: 'claude.ai', tags: ['architecture', 'recall'], created_at: '2026-04-17T14:58:00Z' },
      { id: 'p3', content: 'Decided on append-only memory model — no compression, no summarisation. Vector search handles relevance at query time. This is the core differentiation from competitors.', source: 'chatgpt.com', tags: ['product', 'architecture'], created_at: '2026-04-17T15:44:00Z' },
    ],
  },
  {
    dateKey: '2026-04-15',
    date: 'April 15',
    weekday: 'Tuesday',
    memories: [
      { id: 'p4', content: 'Tech stack: Next.js 15 App Router, TypeScript strict mode, Tailwind 3.4. No Shadcn — custom components only. Inline JSX styles in generated fragments to prevent class leakage.', source: 'claude.ai', tags: ['stack', 'frontend'], created_at: '2026-04-15T09:22:00Z' },
      { id: 'p5', content: 'Embeddings: OpenAI text-embedding-3-small at 1536 dims. Cost ~$0.02/1M tokens. Zero-day retention on the Embeddings API — OpenAI does not store content we send.', source: 'gemini.google.com', tags: ['embeddings', 'privacy'], created_at: '2026-04-15T11:05:00Z' },
    ],
  },
  {
    dateKey: '2026-04-10',
    date: 'April 10',
    weekday: 'Thursday',
    memories: [
      { id: 'p6', content: 'MCP is the Anthropic-blessed protocol for AI tool extensions. The wedge: npx xxiautomate-spine installs Spine into Claude Code and Claude Desktop in 30 seconds.', source: 'claude.ai', tags: ['mcp', 'architecture'], created_at: '2026-04-10T16:18:00Z' },
      { id: 'p7', content: 'Pricing: Free = 100 memories + 1 integration. Pro $9/mo = unlimited + cross-AI. Power $29/mo = team memory + background agents.', source: 'chatgpt.com', tags: ['pricing', 'product'], created_at: '2026-04-10T17:30:00Z' },
      { id: 'p8', content: 'Design reference: Readwise, Arc browser, Apple Journal. Palette: #0D0C0A bg, #E8E4DD text, #E89A3C accent. A library at dusk.', source: 'claude.ai', tags: ['design', 'brand'], created_at: '2026-04-10T18:02:00Z' },
    ],
  },
];

// ── Highlight helper ───────────────────────────────────────────────────────
function highlight(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p)
      ? <mark key={i} className="bg-amber/25 text-amber rounded-[2px] px-[1px] not-italic">{p}</mark>
      : p
  );
}

// ── Search rail ────────────────────────────────────────────────────────────
function SearchRail({
  query,
  setQuery,
  sourceFilter,
  setSourceFilter,
  sources,
  total,
  filtered,
}: {
  query: string;
  setQuery: (q: string) => void;
  sourceFilter: string;
  setSourceFilter: (s: string) => void;
  sources: string[];
  total: number;
  filtered: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-8">
      {/* Search */}
      <div>
        <label className="font-mono text-[10px] uppercase tracking-widest text-cream/25 block mb-3">
          Search
        </label>
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search every word your AI has ever said"
            className="w-full bg-transparent border-b border-cream/15 focus:border-amber/50 pb-2 text-[13px] text-cream placeholder:text-cream/20 outline-none transition-colors duration-500 pr-8"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-0 top-0 font-mono text-[10px] text-cream/30 hover:text-cream/60 transition-colors"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <p className="font-mono text-[10px] text-cream/20 mt-2">
          {query
            ? `${filtered} of ${total}`
            : `${total} memories`}
        </p>
      </div>

      {/* Source filter */}
      {sources.length > 0 && (
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-cream/25 block mb-3">
            Source
          </label>
          <div className="space-y-1.5">
            <button
              onClick={() => setSourceFilter('all')}
              className={`block w-full text-left font-mono text-[11px] py-1 transition-colors duration-300 ${
                sourceFilter === 'all' ? 'text-cream' : 'text-cream/35 hover:text-cream/60'
              }`}
            >
              all sources
            </button>
            {sources.map((s) => {
              const meta = sourceMeta(s);
              return (
                <button
                  key={s}
                  onClick={() => setSourceFilter(sourceFilter === s ? 'all' : s)}
                  className={`flex items-center gap-2 w-full text-left font-mono text-[11px] py-1 transition-colors duration-300 ${
                    sourceFilter === s ? meta.text : 'text-cream/35 hover:text-cream/55'
                  }`}
                >
                  <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${sourceFilter === s ? meta.dot : 'bg-cream/20'}`} />
                  {meta.label.toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Keyboard hint */}
      <p className="font-mono text-[10px] text-cream/15 leading-relaxed">
        ⌘K to focus search
      </p>
    </div>
  );
}

// ── Memory card ────────────────────────────────────────────────────────────
function MemCard({ m, query, index }: { m: MemoryRow; query: string; index: number }) {
  const meta = sourceMeta(m.source);
  const time = formatTime(m.created_at);
  const tags = m.tags ?? [];

  return (
    <div
      className="group relative pl-7 animate-[rise_0.7s_ease_forwards] opacity-0"
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      {/* Thread dot */}
      <span
        className="absolute left-[-3.5px] top-[21px] w-[7px] h-[7px] rounded-full border border-cream/20 bg-night group-hover:border-amber/50 group-hover:bg-amber/15 transition-all duration-500"
        aria-hidden
      />

      {/* Card body */}
      <div className="rounded-lg px-5 py-4 group-hover:bg-amber/[0.035] transition-all duration-500 group-hover:shadow-[0_0_60px_-20px_rgba(232,154,60,0.18)]">
        {/* Meta row */}
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${meta.dot}`} aria-hidden />
            <span className={`font-mono text-[10px] ${meta.text} truncate`}>
              {meta.label}
            </span>
          </div>
          <time className="font-mono text-[10px] text-cream/22 flex-shrink-0">{time}</time>
        </div>

        {/* Content */}
        <p className="text-[14px] leading-[1.75] text-cream/78 mb-3">
          {highlight(m.content, query)}
        </p>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {tags.map((t) => (
              <span key={t} className="font-mono text-[10px] text-cream/25">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Day group ──────────────────────────────────────────────────────────────
function DayGroup({ group, query, cardOffset }: { group: DayGroup; query: string; cardOffset: number }) {
  return (
    <section>
      {/* Day header */}
      <div className="mb-7 pl-7">
        <p className="font-mono text-[10px] uppercase tracking-widest text-amber/45 mb-1.5">
          {group.weekday}
        </p>
        <h2 className="font-serif text-5xl md:text-6xl text-cream/85 leading-none tracking-[-0.01em]">
          {group.date}
        </h2>
        <div className="mt-5 h-px bg-gradient-to-r from-amber/15 via-amber/5 to-transparent" />
      </div>

      {/* Cards */}
      <div className="space-y-1">
        {group.memories.map((m, i) => (
          <MemCard key={m.id} m={m} query={query} index={cardOffset + i} />
        ))}
      </div>
    </section>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="relative min-h-[70vh]">
      {/* Blurred archive preview — what it will look like */}
      <div className="blur-[3px] opacity-35 pointer-events-none select-none space-y-16">
        {PREVIEW_GROUPS.map((g, gi) => (
          <DayGroup key={g.dateKey} group={g} query="" cardOffset={gi * 3} />
        ))}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <div className="max-w-sm space-y-7">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/60 mb-4">
              The archive is quiet.
            </p>
            <h2 className="font-serif text-4xl md:text-5xl italic text-cream leading-tight">
              Your AI has never been here before.
            </h2>
          </div>

          <p className="text-cream/45 text-[14px] leading-relaxed">
            Give it a memory. Install the server once and every conversation leaves a trace.
          </p>

          <div className="space-y-3">
            <div className="bg-night border border-cream/10 rounded-lg px-5 py-3.5 text-left">
              <p className="font-mono text-[10px] text-cream/30 mb-1.5">Paste into ~/.claude/mcp.json</p>
              <p className="font-mono text-[13px] text-amber/80 leading-relaxed whitespace-pre">{`{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "xxiautomate-spine"]
    }
  }
}`}</p>
            </div>

            <p className="font-mono text-[10px] text-cream/25 text-center">
              then restart Claude and ask: "what do you know about me?"
            </p>
          </div>

          <Link
            href="/#install"
            className="inline-block font-mono text-[11px] uppercase tracking-widest text-amber/70 hover:text-amber transition-colors duration-300 border-b border-amber/20 hover:border-amber/50 pb-0.5"
          >
            Full installation guide →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function TimelineClient({ memories, email }: Props) {
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');

  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const m of memories) if (m.source) s.add(m.source);
    return [...s].sort();
  }, [memories]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return memories.filter((m) => {
      if (sourceFilter !== 'all' && m.source !== sourceFilter) return false;
      if (q) {
        const inContent = m.content.toLowerCase().includes(q);
        const inTags = (m.tags ?? []).some((t) => t.toLowerCase().includes(q));
        if (!inContent && !inTags) return false;
      }
      return true;
    });
  }, [memories, query, sourceFilter]);

  const groups = useMemo(() => {
    let offset = 0;
    return groupByDay(filtered).map((g) => {
      const cardOffset = offset;
      offset += g.memories.length;
      return { ...g, cardOffset };
    });
  }, [filtered]);

  const isEmpty = memories.length === 0;

  return (
    <>
      {/* Atmosphere — fixed, never scrolls */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        {/* Lamp bloom */}
        <div className="absolute -top-32 left-[15%] w-[700px] h-[700px] rounded-full bg-amber/[0.055] blur-[220px]" />
        {/* Deep corner shadow */}
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-black/60 blur-[200px]" />
        {/* Film grain */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
          <filter id="grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/75 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember flex-shrink-0" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/dashboard/memories" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">
            Archive
          </Link>
          <Link href="/dashboard/recall" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">
            Recall
          </Link>
          <span className="text-cream/25 hidden md:block">{email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-cream/30 hover:text-amber transition-colors duration-300">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Page hero */}
      <div className="px-6 md:px-16 pt-14 pb-8 max-w-5xl mx-auto relative rise rise-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-4">
          The archive
        </p>
        <h1 className="font-serif text-[clamp(3rem,8vw,6rem)] leading-[0.93] text-cream/90 tracking-[-0.015em]">
          Every word, still here.
        </h1>
        <p className="mt-4 text-cream/38 text-[14px] leading-relaxed max-w-lg">
          {isEmpty
            ? 'Nothing captured yet.'
            : `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} across ${groups.length} ${groups.length === 1 ? 'day' : 'days'}.`}
        </p>
      </div>

      {/* Body */}
      <div className="px-6 md:px-16 pb-32 max-w-5xl mx-auto">
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="flex gap-12 lg:gap-16">
            {/* Mobile search — above timeline */}
            <div className="lg:hidden w-full mb-8">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search every word your AI has ever said"
                className="w-full bg-transparent border-b border-cream/15 focus:border-amber/40 pb-2 text-[13px] text-cream placeholder:text-cream/20 outline-none transition-colors duration-500"
              />
            </div>

            {/* Left rail — desktop only */}
            <aside className="hidden lg:block w-44 flex-shrink-0">
              <div className="sticky top-28">
                <SearchRail
                  query={query}
                  setQuery={setQuery}
                  sourceFilter={sourceFilter}
                  setSourceFilter={setSourceFilter}
                  sources={sources}
                  total={memories.length}
                  filtered={filtered.length}
                />
              </div>
            </aside>

            {/* Timeline */}
            <div className="flex-1 min-w-0 relative">
              {/* Vertical thread */}
              <div
                className="absolute left-0 top-0 w-px bg-gradient-to-b from-amber/20 via-amber/10 to-transparent"
                style={{ height: '100%' }}
                aria-hidden
              />

              {/* Day groups */}
              <div className="space-y-14">
                {groups.length === 0 ? (
                  <div className="pl-7 py-12">
                    <p className="font-serif text-2xl italic text-cream/30">
                      Nothing matches that search.
                    </p>
                    <button
                      onClick={() => { setQuery(''); setSourceFilter('all'); }}
                      className="mt-4 font-mono text-[11px] text-amber/50 hover:text-amber transition-colors duration-300 underline underline-offset-4 decoration-amber/25"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  groups.map(({ cardOffset, ...g }) => (
                    <DayGroup
                      key={g.dateKey}
                      group={g}
                      query={query}
                      cardOffset={cardOffset}
                    />
                  ))
                )}
              </div>

              {/* Footer breath */}
              {groups.length > 0 && (
                <div className="pl-7 pt-20 pb-4">
                  <div className="h-px bg-gradient-to-r from-amber/8 to-transparent" />
                  <p className="font-serif italic text-cream/18 text-sm mt-6">
                    {memories.length === 1
                      ? 'One memory. Every conversation from here compounds it.'
                      : `${memories.length} memories. Every conversation deepens the archive.`}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
