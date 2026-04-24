'use client';

import { useState, useRef } from 'react';

type WhyTrace = {
  bm25: number;
  vec: number;
  recency: number;
  centrality: number;
  final: number;
  dominant: 'bm25' | 'vec' | 'recency' | 'centrality';
};

type Memory = {
  id: string;
  content: string;
  source: string;
  createdAt: string;
  why?: WhyTrace;
  similarity?: number;
};

type Competitor = {
  id: string;
  content: string;
  why: WhyTrace;
};

type DemoResp = {
  memories: Memory[];
  competitors?: Competitor[];
  query: string;
  total?: number;
  latency_ms: number;
  rerank_provider?: string | null;
  rerank_cached?: boolean;
  pool_size?: number;
  error?: string;
};

const SEEDS = [
  'what makes Spine different from ChatGPT Memory',
  'what is the retrieval pipeline',
  'what signals go into the ranker',
  'how does the install work',
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

function labelFor(k: WhyTrace['dominant']): string {
  switch (k) {
    case 'bm25': return 'keyword';
    case 'vec': return 'semantic';
    case 'recency': return 'recency';
    case 'centrality': return 'graph';
  }
}

function WhyBars({ why }: { why: WhyTrace }) {
  const signals: Array<{ k: keyof Pick<WhyTrace, 'bm25' | 'vec' | 'recency' | 'centrality'>; label: string }> = [
    { k: 'bm25', label: 'keyword' },
    { k: 'vec', label: 'semantic' },
    { k: 'recency', label: 'recency' },
    { k: 'centrality', label: 'graph' },
  ];
  return (
    <div className="mt-3 grid grid-cols-4 gap-2">
      {signals.map((s) => {
        const v = Math.max(0, Math.min(1, why[s.k]));
        const isDom = why.dominant === s.k;
        return (
          <div key={s.k}>
            <div className="h-1 bg-cream/[0.06] relative overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${isDom ? 'bg-amber' : 'bg-cream/25'}`}
                style={{ width: `${v * 100}%` }}
              />
            </div>
            <p className={`mt-1 font-mono text-[9px] uppercase tracking-widest ${isDom ? 'text-amber' : 'text-cream/35'}`}>
              {s.label} · {v.toFixed(2)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export function SpineLiveDemo() {
  const [query, setQuery] = useState('');
  const [resp, setResp] = useState<DemoResp | null>(null);
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
    try {
      const res = await fetch(`/api/spine/search?q=${encodeURIComponent(trimmed)}&top_k=5&pool_k=20`, {
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
      setResp(data);
      setStatus('ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatus('error');
      setErr('Network error. Try again.');
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
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
          placeholder="Ask Spine about itself — the demo corpus is 30 curated product memories."
          className="flex-1 bg-transparent border border-cream/15 focus:border-amber focus:outline-none px-4 py-3 text-base placeholder:text-cream/25 transition-colors duration-500"
          aria-label="Demo query"
        />
        <button
          type="submit"
          disabled={status === 'loading' || !query.trim()}
          className="group inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber text-night hover:bg-cream disabled:opacity-50 disabled:hover:bg-amber transition-colors duration-500 font-mono text-[11px] uppercase tracking-widest"
        >
          {status === 'loading' ? 'Ranking…' : 'Recall'}
          <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
        </button>
      </form>

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

      {status === 'error' && err && <p className="mt-6 font-mono text-[11px] text-amber/80">{err}</p>}
      {status === 'unconfigured' && (
        <p className="mt-6 font-mono text-[11px] text-cream/45 border border-cream/10 px-4 py-3">
          Demo endpoint is live but SPINE_DEMO_USER_ID is not set.
        </p>
      )}

      {status === 'ok' && resp && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-5">
            <span>§ Rerank v2 · 4-signal fusion · pool {resp.pool_size ?? '?'} → top {resp.memories.length}</span>
            <span className="inline-flex items-center gap-3">
              {resp.rerank_provider && (
                <span className="text-cream/50">
                  rerank: <span className="text-amber">{resp.rerank_provider}</span>
                  {resp.rerank_cached ? ' · cached' : ''}
                </span>
              )}
              <span className="inline-flex items-center gap-2 text-amber/80">
                <span className="w-1.5 h-1.5 rounded-full bg-amber ember" /> {resp.latency_ms}ms
              </span>
            </span>
          </div>

          <ul className="space-y-4">
            {resp.memories.length === 0 && (
              <li className="font-mono text-[11px] text-cream/40">No memories matched — try a different query.</li>
            )}
            {resp.memories.map((m, i) => (
              <li
                key={m.id}
                className="rise border-l-2 border-amber/50 pl-4 py-3 bg-cream/[0.02]"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <p className="text-cream/90 leading-relaxed text-[15px]">
                  {m.content.length > 280 ? m.content.slice(0, 280) + '…' : m.content}
                </p>
                {m.why && <WhyBars why={m.why} />}
                <div className="mt-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-cream/40">
                  <span>{relativeDate(m.createdAt)}</span>
                  {m.source && (
                    <>
                      <span>·</span>
                      <span>{m.source}</span>
                    </>
                  )}
                  {m.why && (
                    <>
                      <span>·</span>
                      <span className="text-amber">
                        final {m.why.final.toFixed(2)} · {labelFor(m.why.dominant)} dominated
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {resp.competitors && resp.competitors.length > 0 && (
            <div className="mt-8 pt-6 border-t border-cream/[0.06]">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-4">
                § It beat · top 3 competing candidates
              </p>
              <ul className="space-y-3">
                {resp.competitors.map((c) => (
                  <li key={c.id} className="text-[13px] text-cream/55 border-l border-cream/10 pl-3 py-1">
                    <p className="leading-snug">{c.content}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-cream/30">
                      final {c.why.final.toFixed(2)} · {labelFor(c.why.dominant)} dominated
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
