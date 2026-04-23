'use client';

import { useState, useRef } from 'react';

type Memory = {
  id: string;
  content: string;
  source: string;
  createdAt: string;
  similarity: number;
};

type DemoResp = {
  memories: Memory[];
  query: string;
  total: number;
  latency_ms: number;
  error?: string;
};

const SEEDS = [
  'how do we use memory to make Claude the best',
  'what is the compounding effect on my design work',
  'where are the shader rules documented',
  'what’s the MCP install command',
];

function relativeDate(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = Math.floor(ms / (24 * 3600 * 1000));
  if (d < 1) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const months = Math.floor(d / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function SpineLiveDemo() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Memory[] | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error' | 'unconfigured'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus('loading');
    setErr(null);
    const clientT0 = Date.now();
    try {
      const res = await fetch(`/api/demo/search?q=${encodeURIComponent(trimmed)}&limit=3`, {
        signal: ctrl.signal,
      });
      const data = (await res.json()) as DemoResp;
      if (!res.ok) {
        if (res.status === 503) {
          setStatus('unconfigured');
          setErr(data.error ?? 'Demo not configured.');
        } else {
          setStatus('error');
          setErr(data.error ?? 'Recall failed.');
        }
        return;
      }
      setResults(data.memories);
      setLatency(data.latency_ms ?? Date.now() - clientT0);
      setStatus('ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatus('error');
      setErr('Network error. Try again.');
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(query);
        }}
        className="flex flex-col sm:flex-row gap-3"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask Spine something about Roman’s work…"
          className="flex-1 bg-transparent border border-cream/15 focus:border-amber focus:outline-none px-4 py-3 text-base placeholder:text-cream/25 transition-colors duration-500"
          aria-label="Demo query"
        />
        <button
          type="submit"
          disabled={status === 'loading' || !query.trim()}
          className="group inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber text-night hover:bg-cream disabled:opacity-50 disabled:hover:bg-amber transition-colors duration-500 font-mono text-[11px] uppercase tracking-widest"
        >
          {status === 'loading' ? 'Retrieving…' : 'Recall'}
          <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
        </button>
      </form>

      {/* Seeds */}
      {status === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {SEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQuery(s);
                void run(s);
              }}
              className="text-[11px] font-mono text-cream/45 border border-cream/10 hover:border-amber/60 hover:text-amber px-3 py-1.5 transition-colors duration-300"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Status line / latency */}
      {(status === 'ok' || status === 'loading') && (
        <div className="mt-6 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-cream/35">
          <span>Live recall · pgvector + hybrid</span>
          {latency !== null && status === 'ok' && (
            <span className="inline-flex items-center gap-2 text-amber/80">
              <span className="w-1.5 h-1.5 rounded-full bg-amber ember" /> {latency}ms
            </span>
          )}
        </div>
      )}

      {/* Errors */}
      {status === 'error' && err && (
        <p className="mt-6 font-mono text-[11px] text-amber/80">{err}</p>
      )}
      {status === 'unconfigured' && (
        <p className="mt-6 font-mono text-[11px] text-cream/45 border border-cream/10 px-4 py-3">
          Demo endpoint is live but no corpus is wired up yet. Set SPINE_DEMO_USER_ID on the server
          and Spine will recall against the real 310-memory corpus.
        </p>
      )}

      {/* Results */}
      {status === 'ok' && results && (
        <ul className="mt-4 space-y-3">
          {results.length === 0 && (
            <li className="font-mono text-[11px] text-cream/40">
              No memories matched — try one of the seed queries above.
            </li>
          )}
          {results.map((m, i) => (
            <li
              key={m.id}
              className="rise border-l-2 border-amber/40 pl-4 py-2 bg-cream/[0.02]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <p className="text-cream/85 leading-relaxed text-[15px]">
                {m.content.length > 240 ? m.content.slice(0, 240) + '…' : m.content}
              </p>
              <div className="mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-cream/35">
                <span>{relativeDate(m.createdAt)}</span>
                <span>·</span>
                <span>similarity {(m.similarity * 100).toFixed(0)}%</span>
                {m.source && (
                  <>
                    <span>·</span>
                    <span className="truncate max-w-[200px]">{m.source}</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
