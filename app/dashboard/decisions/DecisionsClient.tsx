'use client';

import { useEffect, useMemo, useState } from 'react';

type Decision = {
  id: string;
  statement: string;
  context: string | null;
  status: 'active' | 'superseded' | 'reverted' | 'pending_review';
  confidence: number;
  tags: string[] | null;
  source_memory_id: string | null;
  superseded_by: string | null;
  created_at: string;
};

type Stat = { status: string; total: number; lastAt: string | null };

type DecisionsResponse = {
  decisions: Decision[];
  stats?: Stat[];
};

const STATUSES: Array<Decision['status']> = ['active', 'superseded', 'reverted', 'pending_review'];

const STATUS_COLOR: Record<Decision['status'], string> = {
  active:          'text-amber',
  superseded:      'text-cream/40',
  reverted:        'text-rose-300/80',
  pending_review:  'text-ink-blue',
};

const STATUS_LABEL: Record<Decision['status'], string> = {
  active:          'active',
  superseded:      'superseded',
  reverted:        'reverted',
  pending_review:  'pending',
};

function ago(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isoWeekKey(iso: string): string {
  // Group by ISO week — "Apr 22 — Apr 28, 2026" type label. Simple version
  // that buckets into Mon–Sun. Good enough for a feed view.
  const d = new Date(iso);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return monday.toISOString().slice(0, 10);
}

function formatWeekRange(mondayIso: string): string {
  const m = new Date(mondayIso);
  const s = new Date(m);
  s.setUTCDate(m.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(m)} — ${fmt(s)}, ${m.getUTCFullYear()}`;
}

export function DecisionsClient() {
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [stats, setStats] = useState<Stat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Set<Decision['status']>>(new Set(['active']));
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: '200',
      include_stats: '1',
      status: Array.from(statusFilter).join(','),
    });
    if (search.trim()) params.set('q', search.trim());

    fetch(`/api/decisions?${params.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`decisions ${res.status}`);
        return (await res.json()) as DecisionsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setDecisions(data.decisions);
        setStats(data.stats ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, search]);

  const grouped = useMemo(() => {
    if (!decisions) return [] as Array<{ week: string; items: Decision[] }>;
    const map = new Map<string, Decision[]>();
    for (const d of decisions) {
      const k = isoWeekKey(d.created_at);
      const arr = map.get(k) ?? [];
      arr.push(d);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([week, items]) => ({ week, items }));
  }, [decisions]);

  function toggleStatus(s: Decision['status']) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      if (next.size === 0) return new Set(['active']); // never let it go empty
      return next;
    });
  }

  return (
    <main className="px-6 md:px-10 py-10 max-w-4xl mx-auto">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-2">
          Decisions
        </p>
        <h1 className="font-serif text-4xl text-cream">
          Every choice you&apos;ve made, kept on the record.
        </h1>
        <p className="text-cream/60 leading-relaxed mt-3 max-w-2xl">
          Spine distils the decisions inside your conversations into one-sentence statements.
          When a later decision overturns an earlier one, the earlier becomes <em className="italic">superseded</em>.
          Nothing is deleted. The full chain is here.
        </p>
      </header>

      {/* Per-status stat cards — also act as filter toggles. */}
      {stats && stats.length > 0 && (
        <section className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATUSES.map((s) => {
            const stat = stats.find((x) => x.status === s);
            const total = stat?.total ?? 0;
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`flex flex-col gap-1 px-4 py-4 rounded-xl border text-left transition ${
                  statusFilter.has(s)
                    ? 'border-amber/40 bg-cream/[0.04]'
                    : 'border-cream/8 bg-cream/[0.01] opacity-50'
                }`}
              >
                <span className={`font-mono text-[10px] uppercase tracking-widest ${STATUS_COLOR[s]}`}>
                  {STATUS_LABEL[s]}
                </span>
                <span className="font-serif text-3xl text-cream leading-none">{total}</span>
                <span className="font-mono text-[10px] text-cream/30 mt-1">
                  {stat?.lastAt ? `last: ${ago(stat.lastAt)}` : 'none'}
                </span>
              </button>
            );
          })}
        </section>
      )}

      <section className="mb-6 flex items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search decisions"
          className="flex-1 max-w-md px-4 py-2.5 rounded-lg border border-cream/10 bg-cream/[0.02] text-[14px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-amber/40"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/50 hover:text-amber"
          >
            Clear
          </button>
        )}
      </section>

      {loading && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40">Loading…</p>
      )}

      {error && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-rose-300">{error}</p>
      )}

      {!loading && !error && decisions && decisions.length === 0 && (
        <div className="px-8 py-16 rounded-xl border border-cream/8 bg-cream/[0.02] text-center">
          <p className="font-serif text-2xl text-cream/70">No decisions yet.</p>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mt-3">
            Spine extracts decisions from your captures. Use Claude Code for a few sessions.
          </p>
          <p className="font-mono text-[10px] text-cream/25 mt-3 max-w-md mx-auto leading-relaxed">
            Extraction needs <code className="text-amber/60">ANTHROPIC_API_KEY</code> set on the
            server. Without it, captures are still stored — only the decisions layer goes quiet.
          </p>
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <div className="flex flex-col gap-12">
          {grouped.map(({ week, items }) => (
            <section key={week}>
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/30 mb-4 sticky top-[68px] bg-night/85 backdrop-blur-sm py-2 z-10">
                {formatWeekRange(week)}
                <span className="ml-3 text-cream/20">{items.length} decision{items.length === 1 ? '' : 's'}</span>
              </p>
              <ol className="flex flex-col gap-3">
                {items.map((d) => (
                  <DecisionRow key={d.id} d={d} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function DecisionRow({ d }: { d: Decision }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="px-5 py-4 rounded-xl border border-cream/8 bg-cream/[0.02] hover:bg-cream/[0.04] transition">
      <div className="flex items-start gap-4">
        <span className={`font-mono text-[10px] uppercase tracking-widest mt-1 ${STATUS_COLOR[d.status]}`}>
          {STATUS_LABEL[d.status]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-serif text-lg text-cream leading-snug">
            {d.statement}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="font-mono text-[10px] text-cream/30">{ago(d.created_at)}</span>
            {d.tags && d.tags.length > 0 && (
              <span className="flex gap-1.5">
                {d.tags.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[9px] uppercase tracking-wider text-amber/60 border border-amber/20 px-1.5 py-0.5 rounded"
                  >
                    {t}
                  </span>
                ))}
              </span>
            )}
            <span className="font-mono text-[10px] text-cream/25">
              confidence {Math.round(d.confidence * 100)}%
            </span>
            {d.context && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-auto font-mono text-[10px] uppercase tracking-widest text-cream/40 hover:text-amber transition"
              >
                {expanded ? 'Hide' : 'Show context'}
              </button>
            )}
          </div>
          {expanded && d.context && (
            <pre className="mt-3 px-3 py-2.5 rounded-lg bg-cream/[0.03] border border-cream/[0.06] font-mono text-[11px] text-cream/55 whitespace-pre-wrap break-words leading-relaxed">
              {d.context}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
