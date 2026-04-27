'use client';

import { useState } from 'react';

type Candidate = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  vecSimilarity: number;
  bm25Rank: number;
  vecRankPos: number;
  bm25RankPos: number;
  rrfScore: number;
  ageDays: number;
  decay: number;
  fusedScore: number;
};

type Pick = { id: string; score: number; reason: string };

type DebugResponse = {
  query: string;
  candidates: Candidate[];
  picks: Pick[];
  final: Array<{ pick: Pick; memory: Candidate }>;
  block: string;
  timings: {
    retrieval_ms: number;
    rerank_ms: number;
    total_ms: number;
    rerank_latency_ms: number;
  };
  cost_usd: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  rerank_error: string | null;
  raw_text: string;
};

export function RecallClient() {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DebugResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/recall/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), limit }),
      });
      const body = (await res.json()) as DebugResponse | { error: string };
      if (!res.ok || 'error' in body) {
        throw new Error('error' in body ? body.error : `Request failed: ${res.status}`);
      }
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  async function copyBlock() {
    if (!data?.block) return;
    try {
      await navigator.clipboard.writeText(data.block);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mb-16 border border-cream/10 p-6 md:p-8">
        <label
          htmlFor="q"
          className="block font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-4"
        >
          Query
        </label>
        <input
          id="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "what did I decide about the launch date?"'
          className="w-full bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-3 text-lg placeholder:text-cream/25"
        />
        <div className="mt-6 flex flex-col md:flex-row md:items-end gap-4">
          <label className="flex flex-col gap-2 md:w-48">
            <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
              Final pick limit
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
              className="bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-2 text-lg"
            />
          </label>
          <div className="flex-1" />
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="bg-amber text-night font-mono text-[12px] uppercase tracking-widest px-6 py-3 disabled:opacity-50"
          >
            {busy ? 'Running…' : 'Run recall'}
          </button>
        </div>
        {error && <p className="mt-4 font-mono text-[11px] text-amber">{error}</p>}
      </form>

      {data && (
        <div className="space-y-16">
          <StatsStrip data={data} />
          <Section title="Injected block" count={data.final.length}>
            <div className="border border-amber/30 bg-amber/5 p-6">
              <pre className="font-mono text-sm text-cream/90 whitespace-pre-wrap leading-relaxed">
                {data.block || '(empty — no candidates)'}
              </pre>
              {data.block && (
                <button
                  onClick={copyBlock}
                  className="mt-5 font-mono text-[11px] uppercase tracking-widest border border-cream/20 hover:border-cream/40 px-4 py-2 text-cream/80"
                >
                  {copied ? 'Copied' : 'Copy block'}
                </button>
              )}
            </div>
          </Section>

          <Section title="Reranked top 5" count={data.final.length}>
            {data.final.length === 0 ? (
              <p className="text-cream/50">No reranked picks.</p>
            ) : (
              <ul className="space-y-8">
                {data.final.map(({ pick, memory }, i) => (
                  <li key={memory.id} className="border-l-2 border-amber/60 pl-6 py-1">
                    <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-3 flex gap-4 flex-wrap">
                      <span>#{i + 1}</span>
                      <span className="text-amber">score {pick.score.toFixed(3)}</span>
                      <span className="text-cream/30">age {Math.round(memory.ageDays)}d</span>
                    </p>
                    <p className="font-serif text-lg text-cream/90 leading-relaxed mb-3">
                      {memory.content}
                    </p>
                    {pick.reason && (
                      <p className="font-mono text-[11px] text-cream/50 italic mb-4">
                        reason: {pick.reason}
                      </p>
                    )}
                    <WhyBars memory={memory} pickScore={pick.score} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Candidates (pre-rerank)" count={data.candidates.length}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-cream/40 border-b border-cream/10">
                    <th className="py-3 pr-4">#</th>
                    <th className="py-3 pr-4">fused</th>
                    <th className="py-3 pr-4">rrf</th>
                    <th className="py-3 pr-4">decay</th>
                    <th className="py-3 pr-4">vec</th>
                    <th className="py-3 pr-4">bm25</th>
                    <th className="py-3 pr-4">age</th>
                    <th className="py-3">content</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.map((c, i) => (
                    <tr key={c.id} className="border-b border-cream/5 align-top">
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/40">{i + 1}</td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-amber">
                        {c.fusedScore.toFixed(4)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                        {c.rrfScore.toFixed(4)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                        {c.decay.toFixed(2)}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                        {c.vecSimilarity.toFixed(3)}
                        {c.vecRankPos > 0 && (
                          <span className="text-cream/30"> (#{c.vecRankPos})</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/60">
                        {c.bm25Rank.toFixed(3)}
                        {c.bm25RankPos > 0 && (
                          <span className="text-cream/30"> (#{c.bm25RankPos})</span>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[11px] text-cream/40">
                        {Math.round(c.ageDays)}d
                      </td>
                      <td className="py-3 text-cream/80 max-w-xl">
                        <span className="line-clamp-2">{c.content}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {data.rerank_error && (
            <div className="border border-amber/40 bg-amber/5 px-5 py-4 text-sm text-cream/80">
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-2">
                Rerank unavailable
              </p>
              <p>{data.rerank_error}</p>
              <p className="mt-2 text-cream/50">
                Falling back to fused RRF + decay ordering. Set{' '}
                <code className="font-mono text-amber">ANTHROPIC_API_KEY</code> to enable
                Haiku reranking.
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-6">
        {title}
        {typeof count === 'number' ? ` · ${count}` : ''}
      </p>
      {children}
    </section>
  );
}

// WhyBars — the "make Spine's technical depth visible" panel.
//
// Four horizontal bars per result, widths proportional to each signal's
// normalised contribution. Hovering a bar shows the precise number. The
// difference between "magic black box" and "I can SEE why this ranked
// first" — when a result has a tall vector bar but flat BM25 bar, the
// user understands "this matched semantically but not by keyword." That's
// the moat made legible.
function WhyBars({ memory, pickScore }: { memory: Candidate; pickScore: number }) {
  // Normalise each signal to 0..1 for the bar widths. The numbers come from
  // different ranges so we scale them sensibly:
  //   vec       — already 0..1 (cosine similarity)
  //   bm25      — Postgres ts_rank, typically 0..1, occasionally up to ~3
  //   decay     — already 0..1 (exp(-days/30))
  //   rerank    — pickScore from the cross-encoder, normalised here as the
  //               share of pickScore over the result's fusedScore so it
  //               reads as "the rerank's lift over the fused base"
  const signals: Array<{ key: string; label: string; value: number; raw: string; color: string }> = [
    {
      key: 'vec',
      label: 'Semantic',
      value: Math.max(0, Math.min(1, memory.vecSimilarity)),
      raw: memory.vecSimilarity.toFixed(3),
      color: '#E89A3C',
    },
    {
      key: 'bm25',
      label: 'Keyword',
      value: Math.max(0, Math.min(1, memory.bm25Rank / 1.5)),
      raw: memory.bm25Rank.toFixed(3),
      color: '#7AB3A0',
    },
    {
      key: 'decay',
      label: 'Recency',
      value: Math.max(0, Math.min(1, memory.decay)),
      raw: `${memory.decay.toFixed(2)} (${Math.round(memory.ageDays)}d old)`,
      color: '#6B7FFF',
    },
    {
      key: 'rerank',
      label: 'Rerank',
      value: Math.max(0, Math.min(1, pickScore / Math.max(memory.fusedScore || 1, 0.001) / 2)),
      raw: pickScore.toFixed(3),
      color: '#C084FC',
    },
  ];

  return (
    <div className="border border-cream/[0.06] rounded-lg p-4 bg-cream/[0.015]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
        Why this ranked
      </p>
      <ul className="space-y-2.5">
        {signals.map((s) => (
          <li key={s.key} className="grid grid-cols-[80px_1fr_88px] gap-3 items-center">
            <span className="font-mono text-[10px] uppercase tracking-wider text-cream/50">
              {s.label}
            </span>
            <div className="h-2 bg-cream/[0.05] rounded-full overflow-hidden" title={s.raw}>
              <div
                className="h-full transition-[width] duration-700 ease-out rounded-full"
                style={{ width: `${Math.round(s.value * 100)}%`, background: s.color }}
              />
            </div>
            <span className="font-mono text-[10px] text-cream/45 text-right">{s.raw}</span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[9px] text-cream/25 mt-3 leading-relaxed">
        Spine fuses four signals plus a cross-encoder rerank. Most products only do the first.
        That&apos;s why an exact-keyword query and a fuzzy-concept query both land the right memory.
      </p>
    </div>
  );
}

function StatsStrip({ data }: { data: DebugResponse }) {
  const stats: Array<[string, string]> = [
    ['candidates', String(data.candidates.length)],
    ['picked', String(data.final.length)],
    ['retrieval', `${data.timings.retrieval_ms}ms`],
    ['rerank', `${data.timings.rerank_ms}ms`],
    ['tokens in', String(data.tokens.input + data.tokens.cache_read + data.tokens.cache_write)],
    ['tokens out', String(data.tokens.output)],
    ['cost', `$${data.cost_usd.toFixed(5)}`],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-7 gap-px bg-cream/10 border border-cream/10">
      {stats.map(([k, v]) => (
        <div key={k} className="bg-night px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-1">
            {k}
          </p>
          <p className="font-serif text-2xl text-cream">{v}</p>
        </div>
      ))}
    </div>
  );
}
