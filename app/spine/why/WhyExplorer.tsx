'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Signals = { bm25: number; vec: number; recency: number; centrality: number };

type PoolItem = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  supersededBy: string | null;
  signals: Signals;
  fused_final: number;
  dominant: keyof Signals;
  cross_encoder_score: number | null;
};

type ApiResp = {
  query: string;
  pool: PoolItem[];
  weights: {
    bm25_w: number;
    vec_w: number;
    recency_w: number;
    centrality_w: number;
    bias: number;
    model_version: string;
    training_n: number;
  };
  pool_size: number;
  latency_ms: number;
  rerank_provider: string | null;
  rerank_cached?: boolean;
  error?: string;
};

type Weights = {
  bm25: number;
  vec: number;
  recency: number;
  centrality: number;
};

const DEFAULT_WEIGHTS: Weights = { bm25: 0.25, vec: 0.55, recency: 0.1, centrality: 0.1 };
const SEEDS = [
  'what is the retrieval pipeline',
  'how does Spine differ from ChatGPT memory',
  'why append-only',
  'what are the ranking signals',
];

function normaliseWeights(w: Weights): Weights {
  const sum = w.bm25 + w.vec + w.recency + w.centrality;
  if (sum <= 0) return DEFAULT_WEIGHTS;
  return {
    bm25: w.bm25 / sum,
    vec: w.vec / sum,
    recency: w.recency / sum,
    centrality: w.centrality / sum,
  };
}

function dominantOf(contribs: Record<keyof Weights, number>): keyof Weights {
  let best: keyof Weights = 'vec';
  let v = -Infinity;
  (Object.keys(contribs) as Array<keyof Weights>).forEach((k) => {
    if (contribs[k] > v) {
      v = contribs[k];
      best = k;
    }
  });
  return best;
}

function relativeDate(iso: string): string {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(d)) return '';
  if (d < 1) return 'today';
  if (d === 1) return '1d';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

const SIGNAL_LABEL: Record<keyof Weights, string> = {
  bm25: 'keyword',
  vec: 'semantic',
  recency: 'recency',
  centrality: 'graph',
};

export function WhyExplorer() {
  const [query, setQuery] = useState('what is the retrieval pipeline');
  const [resp, setResp] = useState<ApiResp | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [savedName, setSavedName] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
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
      const r = await fetch(`/api/spine/candidates?q=${encodeURIComponent(trimmed)}&pool_k=20`, {
        signal: ctrl.signal,
      });
      const data = (await r.json()) as ApiResp;
      if (!r.ok) {
        setStatus('error');
        setErr(data.error ?? 'candidates fetch failed');
        return;
      }
      setResp(data);
      // Initialise sliders from the server's active weights (unnormalised → client normalises).
      setWeights({
        bm25: data.weights.bm25_w,
        vec: data.weights.vec_w,
        recency: data.weights.recency_w,
        centrality: data.weights.centrality_w,
      });
      setStatus('ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setStatus('error');
      setErr('network error');
    }
  }

  useEffect(() => {
    void run(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const norm = useMemo(() => normaliseWeights(weights), [weights]);

  const scored = useMemo(() => {
    if (!resp) return [];
    return resp.pool
      .map((item) => {
        const contribs = {
          bm25: norm.bm25 * item.signals.bm25,
          vec: norm.vec * item.signals.vec,
          recency: norm.recency * item.signals.recency,
          centrality: norm.centrality * item.signals.centrality,
        };
        const final = Math.max(
          0,
          Math.min(1, contribs.bm25 + contribs.vec + contribs.recency + contribs.centrality)
        );
        const dom = dominantOf(contribs);
        return { item, contribs, final, dominant: dom };
      })
      .sort((a, b) => b.final - a.final);
  }, [resp, norm]);

  function saveProfile() {
    if (!savedName.trim()) return;
    void fetch('/api/spine-weight-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: savedName.trim(),
        bm25_w: norm.bm25,
        vec_w: norm.vec,
        recency_w: norm.recency,
        centrality_w: norm.centrality,
      }),
    })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (r.ok) {
          setCopyFeedback(`saved "${savedName.trim()}"`);
        } else if (r.status === 401) {
          setCopyFeedback('sign in to save · ' + copyProfileJson());
        } else {
          setCopyFeedback(`save failed: ${data.error ?? 'unknown'}`);
        }
      })
      .catch(() => setCopyFeedback('save failed'));
  }

  function copyProfileJson(): string {
    const payload = {
      bm25_w: Number(norm.bm25.toFixed(4)),
      vec_w: Number(norm.vec.toFixed(4)),
      recency_w: Number(norm.recency.toFixed(4)),
      centrality_w: Number(norm.centrality.toFixed(4)),
    };
    return JSON.stringify(payload);
  }

  async function copyToClipboard() {
    const json = copyProfileJson();
    try {
      await navigator.clipboard.writeText(json);
      setCopyFeedback(`copied · ${json}`);
    } catch {
      setCopyFeedback(`couldn't copy · ${json}`);
    }
  }

  return (
    <div className="space-y-8">
      {/* Query bar */}
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
          placeholder="Ask anything the demo corpus might know…"
          className="flex-1 bg-transparent border border-cream/15 focus:border-amber focus:outline-none px-4 py-3 text-base placeholder:text-cream/25 transition-colors"
          aria-label="Query"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber text-night hover:bg-cream disabled:opacity-50 transition-colors duration-500 font-mono text-[11px] uppercase tracking-widest"
        >
          {status === 'loading' ? 'Fetching pool…' : 'Recall'}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {SEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuery(s);
              void run(s);
            }}
            className="text-[11px] font-mono text-cream/45 border border-cream/10 hover:border-amber/60 hover:text-amber px-3 py-1.5 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {err && <p className="font-mono text-[11px] text-amber/80">{err}</p>}

      {status === 'ok' && resp && (
        <div className="grid lg:grid-cols-[280px,1fr] gap-6 md:gap-8">
          {/* Sliders */}
          <aside className="space-y-6 border border-cream/[0.08] bg-cream/[0.015] p-5 md:p-6 lg:sticky lg:top-24 self-start">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber">
                § Weight sliders
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/30">
                server active: {resp.weights.model_version} · trained on {resp.weights.training_n}
              </p>
            </div>

            {(['bm25', 'vec', 'recency', 'centrality'] as Array<keyof Weights>).map((k) => (
              <div key={k}>
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest mb-2">
                  <span className="text-cream/65">{SIGNAL_LABEL[k]}</span>
                  <span className="text-amber">{norm[k].toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={weights[k]}
                  onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))}
                  className="w-full accent-amber"
                  aria-label={`${SIGNAL_LABEL[k]} weight`}
                />
              </div>
            ))}

            <div className="pt-4 border-t border-cream/[0.06] space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/50">
                § Presets
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase tracking-widest">
                <button
                  onClick={() => setWeights({ bm25: 0.25, vec: 0.55, recency: 0.1, centrality: 0.1 })}
                  className="border border-cream/15 hover:border-amber/50 text-cream/60 hover:text-amber py-2 transition-colors"
                >
                  Default
                </button>
                <button
                  onClick={() => setWeights({ bm25: 0.0, vec: 1.0, recency: 0.0, centrality: 0.0 })}
                  className="border border-cream/15 hover:border-amber/50 text-cream/60 hover:text-amber py-2 transition-colors"
                >
                  Semantic only
                </button>
                <button
                  onClick={() => setWeights({ bm25: 1.0, vec: 0.0, recency: 0.0, centrality: 0.0 })}
                  className="border border-cream/15 hover:border-amber/50 text-cream/60 hover:text-amber py-2 transition-colors"
                >
                  Keyword only
                </button>
                <button
                  onClick={() => setWeights({ bm25: 0.15, vec: 0.35, recency: 0.35, centrality: 0.15 })}
                  className="border border-cream/15 hover:border-amber/50 text-cream/60 hover:text-amber py-2 transition-colors"
                >
                  Recent-first
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-cream/[0.06] space-y-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/50">
                § Save or copy
              </p>
              <div className="flex gap-2">
                <input
                  value={savedName}
                  onChange={(e) => setSavedName(e.target.value)}
                  placeholder="profile name"
                  className="flex-1 bg-transparent border border-cream/15 focus:border-amber focus:outline-none px-2 py-1.5 text-[12px] placeholder:text-cream/25"
                />
                <button
                  onClick={saveProfile}
                  className="font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 bg-amber text-night hover:bg-cream transition-colors"
                >
                  Save
                </button>
              </div>
              <button
                onClick={copyToClipboard}
                className="w-full font-mono text-[10px] uppercase tracking-widest border border-cream/15 hover:border-amber/60 text-cream/60 hover:text-amber py-2 transition-colors"
              >
                Copy as JSON →
              </button>
              {copyFeedback && (
                <p className="font-mono text-[10px] text-amber/80 break-all">{copyFeedback}</p>
              )}
            </div>

            <div className="pt-4 border-t border-cream/[0.06] font-mono text-[10px] uppercase tracking-widest text-cream/35">
              pool {resp.pool_size} · {resp.latency_ms}ms · rerank {resp.rerank_provider ?? 'none'}
              {resp.rerank_cached ? ' · cached' : ''}
            </div>
          </aside>

          {/* Results */}
          <div>
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-4">
              <span>§ Live top-{scored.length} · reorders as you drag</span>
              <span>
                weights normalise to 1 · {Object.values(norm).reduce((s, v) => s + v, 0).toFixed(2)}
              </span>
            </div>

            <ol className="space-y-3">
              {scored.map(({ item, contribs, final, dominant }, i) => {
                const isTop5 = i < 5;
                return (
                  <li
                    key={item.id}
                    className={`p-4 md:p-5 border transition-colors duration-300 ${
                      isTop5
                        ? 'border-amber/40 bg-amber/[0.03]'
                        : 'border-cream/[0.06] bg-cream/[0.01] opacity-80'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-4 mb-3">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-amber shrink-0">
                        #{i + 1}
                      </span>
                      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-cream/40 shrink-0">
                        {item.source && <span>{item.source}</span>}
                        <span>{relativeDate(item.createdAt)}</span>
                        {item.cross_encoder_score !== null && (
                          <span className="text-cream/60">
                            ce {item.cross_encoder_score.toFixed(2)}
                          </span>
                        )}
                        <span className="text-amber">final {final.toFixed(2)}</span>
                      </div>
                    </div>
                    <p className="text-cream/85 leading-relaxed text-[14px] mb-3">
                      {item.content.length > 220
                        ? item.content.slice(0, 220) + '…'
                        : item.content}
                    </p>
                    <div className="grid grid-cols-4 gap-3">
                      {(['bm25', 'vec', 'recency', 'centrality'] as Array<keyof Weights>).map((k) => {
                        const raw = item.signals[k];
                        const contrib = contribs[k];
                        const isDom = dominant === k;
                        return (
                          <div key={k}>
                            <div className="h-1 bg-cream/[0.06] relative overflow-hidden">
                              <div
                                className={`absolute inset-y-0 left-0 ${
                                  isDom ? 'bg-amber' : 'bg-cream/25'
                                }`}
                                style={{ width: `${Math.max(0, Math.min(1, raw)) * 100}%` }}
                              />
                            </div>
                            <p
                              className={`mt-1 font-mono text-[9px] uppercase tracking-widest ${
                                isDom ? 'text-amber' : 'text-cream/35'
                              }`}
                            >
                              {SIGNAL_LABEL[k]} · {raw.toFixed(2)}{' '}
                              <span className="text-cream/30">(→{contrib.toFixed(2)})</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
