'use client';

import Link from 'next/link';
import { useState, useRef, useCallback, type FormEvent } from 'react';

type ScoreSet = { cosine: number; recency: number; composite: number };

type AskResult = {
  id: string;
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  scores: ScoreSet;
  continueUrl: string;
  retrievalCount: number;
};

type AskResponse = {
  results: AskResult[];
  bySource: Record<string, AskResult[]>;
  query: string;
  intent: string;
  terms: string[];
  mentionedSources: string[];
  embedMs: number;
  searchMs: number;
  totalMs: number;
};

// ── Source display ────────────────────────────────────────────────────────

type SourceDisplay = { label: string; shortLabel: string; color: string; dot: string };

const SOURCE_DISPLAY: Record<string, SourceDisplay> = {
  'claude.ai':         { label: 'Claude',  shortLabel: 'Claude',  color: 'text-amber',       dot: 'bg-amber' },
  'chatgpt.com':       { label: 'ChatGPT', shortLabel: 'GPT',     color: 'text-emerald-400', dot: 'bg-emerald-400' },
  'chatgpt':           { label: 'ChatGPT', shortLabel: 'GPT',     color: 'text-emerald-400', dot: 'bg-emerald-400' },
  'gemini.google.com': { label: 'Gemini',  shortLabel: 'Gemini',  color: 'text-sky-400',     dot: 'bg-sky-400' },
  'gemini':            { label: 'Gemini',  shortLabel: 'Gemini',  color: 'text-sky-400',     dot: 'bg-sky-400' },
  'v0.dev':            { label: 'v0',      shortLabel: 'v0',      color: 'text-violet-400',  dot: 'bg-violet-400' },
  'cursor.sh':         { label: 'Cursor',  shortLabel: 'Cursor',  color: 'text-blue-400',    dot: 'bg-blue-400' },
  'codeium.com':       { label: 'Codeium', shortLabel: 'Codeium', color: 'text-teal-400',    dot: 'bg-teal-400' },
};

function display(source: string): SourceDisplay {
  return SOURCE_DISPLAY[source] ?? {
    label: source,
    shortLabel: source.split('.')[0],
    color: 'text-cream/50',
    dot: 'bg-cream/30',
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function highlight(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const pattern = terms
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark key={i} className="bg-amber/20 text-amber rounded-[2px] px-[1px]">{p}</mark>
    ) : p
  );
}

// ── Result card ───────────────────────────────────────────────────────────

function ResultCard({ result, terms, rank }: { result: AskResult; terms: string[]; rank: number }) {
  const d = display(result.source);
  const pct = Math.round(result.scores.composite * 100);
  const barPct = Math.max(4, pct);

  return (
    <article className="group relative border border-cream/[0.07] hover:border-amber/25 rounded-xl overflow-hidden transition-all duration-500 hover:shadow-[0_0_50px_-18px_rgba(232,154,60,0.2)]">
      {/* Rank ribbon */}
      <div className="absolute top-0 left-0 w-px h-full bg-gradient-to-b from-amber/40 via-amber/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${d.dot}`} aria-hidden />
            <span className={`font-mono text-[11px] ${d.color}`}>{d.label}</span>
            <span className="font-mono text-[10px] text-cream/25">·</span>
            <span className="font-mono text-[10px] text-cream/30">{formatDate(result.createdAt)}</span>
            {result.retrievalCount > 0 && (
              <>
                <span className="font-mono text-[10px] text-cream/20">·</span>
                <span className="font-mono text-[10px] text-cream/25" title="Times recalled">
                  ↺ {result.retrievalCount}
                </span>
              </>
            )}
          </div>
          <span className="font-mono text-[10px] text-cream/25 flex-shrink-0">
            #{rank}
          </span>
        </div>

        {/* Content */}
        <p className="text-[14px] leading-[1.75] text-cream/80 mb-4 line-clamp-5">
          {highlight(result.content, terms)}
        </p>

        {/* Tags */}
        {result.tags.length > 0 && (
          <div className="flex flex-wrap gap-2.5 mb-4">
            {result.tags.map((t) => (
              <span key={t} className="font-mono text-[10px] text-cream/28">#{t}</span>
            ))}
          </div>
        )}

        {/* Score bar + continue button */}
        <div className="flex items-center gap-4">
          <div className="flex-1 flex items-center gap-2.5">
            <div className="flex-1 h-[2px] bg-cream/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-amber/50 rounded-full transition-all duration-700"
                style={{ width: `${barPct}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-cream/25 flex-shrink-0 w-8 text-right">
              {pct}%
            </span>
          </div>

          {result.continueUrl && result.continueUrl !== '#' && (
            <a
              href={result.continueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[10px] uppercase tracking-wider text-amber/50 hover:text-amber transition-colors duration-300 border-b border-amber/20 hover:border-amber/50 pb-[1px] flex-shrink-0"
            >
              Continue →
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

// ── Empty / initial states ─────────────────────────────────────────────────

function EmptyPrompt() {
  return (
    <div className="text-center py-24">
      <p className="font-serif italic text-2xl text-cream/25 mb-3">
        Ask anything your AI has ever heard.
      </p>
      <p className="font-mono text-[11px] text-cream/18">
        Try: "what did we decide about the database" · "my deployment setup" · "client Sarah"
      </p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="text-center py-24">
      <p className="font-serif italic text-2xl text-cream/30 mb-3">
        Nothing surfaced for "{query}".
      </p>
      <p className="font-mono text-[11px] text-cream/25">
        Try fewer words, or check that the extension is capturing from your AI chats.
      </p>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="text-center py-20">
      <p className="font-mono text-[11px] uppercase tracking-widest text-amber/50 mb-3">Retrieval failed</p>
      <p className="text-cream/40 text-sm">{msg}</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; data: AskResponse }
  | { phase: 'error'; msg: string };

export function AskClient({ email }: { email: string }) {
  const [input, setInput] = useState('');
  const [state, setState] = useState<State>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ phase: 'loading' });

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit: 12 }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        setState({ phase: 'error', msg: err.error ?? `Server error ${res.status}` });
        return;
      }

      const data = (await res.json()) as AskResponse;
      setState({ phase: 'done', data });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setState({ phase: 'error', msg: (e as Error).message });
    }
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void search(input);
  }

  const isDone = state.phase === 'done';
  const results = isDone ? state.data.results : [];
  const terms = isDone ? state.data.terms : [];
  const timing = isDone
    ? `${state.data.embedMs}ms embed · ${state.data.searchMs}ms search · ${state.data.totalMs}ms total`
    : null;

  return (
    <>
      {/* Atmosphere */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/3 w-[800px] h-[800px] rounded-full bg-amber/[0.045] blur-[240px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-black/50 blur-[200px]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.025]" xmlns="http://www.w3.org/2000/svg">
          <filter id="g2">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#g2)" />
        </svg>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/75 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/timeline" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Timeline</Link>
          <Link href="/dashboard/memories" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Archive</Link>
          <span className="text-cream/22 hidden md:block">{email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-cream/30 hover:text-amber transition-colors duration-300">Sign out</button>
          </form>
        </div>
      </header>

      {/* Page */}
      <div className="relative px-6 md:px-16 max-w-4xl mx-auto">
        {/* Hero */}
        <div className="pt-16 pb-10 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-4">Cross-AI retrieval</p>
          <h1 className="font-serif text-[clamp(2.8rem,7vw,5rem)] leading-[0.95] text-cream/90 tracking-[-0.015em] mb-4">
            Ask your archive.
          </h1>
          <p className="text-cream/38 text-sm leading-relaxed max-w-lg">
            Every conversation you have had — across Claude, ChatGPT, Gemini, v0 — retrieved by meaning,
            not keyword. Ranked by relevance, recency, and how often you have returned to it.
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={onSubmit} className="mb-3 rise rise-2">
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'what did we decide about the database'}
              className="w-full bg-cream/[0.03] border border-cream/[0.12] focus:border-amber/45 rounded-xl px-6 py-5 pr-32 font-sans text-[15px] text-cream placeholder:text-cream/22 outline-none transition-all duration-500 focus:bg-cream/[0.05]"
              autoFocus
            />
            <button
              type="submit"
              disabled={state.phase === 'loading' || !input.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 px-5 py-2.5 bg-amber text-night font-sans text-[13px] font-semibold rounded-lg transition-all duration-300 disabled:opacity-40 hover:opacity-90"
            >
              {state.phase === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {/* Timing + result count */}
        {timing && (
          <div className="flex items-center justify-between mb-8">
            <p className="font-mono text-[10px] text-cream/25">
              {results.length} {results.length === 1 ? 'memory' : 'memories'}
              {state.phase === 'done' && state.data.intent && ` · ${state.data.intent}`}
            </p>
            <p className="font-mono text-[10px] text-cream/18">{timing}</p>
          </div>
        )}

        {/* Results */}
        <div className="pb-32">
          {state.phase === 'idle' && <EmptyPrompt />}
          {state.phase === 'loading' && (
            <div className="space-y-4 mt-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border border-cream/[0.07] rounded-xl p-6 animate-pulse">
                  <div className="flex gap-3 mb-4">
                    <div className="w-[6px] h-[6px] rounded-full bg-cream/10 mt-1" />
                    <div className="h-3 bg-cream/10 rounded w-24" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3.5 bg-cream/10 rounded w-full" />
                    <div className="h-3.5 bg-cream/10 rounded w-4/5" />
                    <div className="h-3.5 bg-cream/10 rounded w-3/5" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {state.phase === 'error' && <ErrorState msg={state.msg} />}
          {state.phase === 'done' && results.length === 0 && <NoResults query={state.data.query} />}
          {state.phase === 'done' && results.length > 0 && (
            <div className="space-y-3 mt-2">
              {results.map((r, i) => (
                <ResultCard key={r.id} result={r} terms={terms} rank={i + 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
