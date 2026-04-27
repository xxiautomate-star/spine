'use client';

import { useEffect, useMemo, useState } from 'react';

type AuditRow = {
  id: number;
  op: 'read' | 'write' | 'embed' | 'reembed' | 'delete';
  memoryId: string | null;
  query: string | null;
  caller: string | null;
  mime: string | null;
  embedProvider: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type AuditStat = {
  op: string;
  total: number;
  lastAt: string | null;
  uniqueCallers: number;
};

type AuditResponse = {
  rows: AuditRow[];
  stats?: AuditStat[];
};

const OP_COLOR: Record<string, string> = {
  read: 'text-ink-blue',
  write: 'text-amber',
  embed: 'text-cream/70',
  reembed: 'text-cream/50',
  delete: 'text-rose-300',
};

const OP_LABEL: Record<string, string> = {
  read: 'recall',
  write: 'capture',
  embed: 'embed',
  reembed: 're-embed',
  delete: 'forget',
};

function ago(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.floor((now - d) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.slice(0, 8);
}

const ALL_OPS: Array<AuditRow['op']> = ['read', 'write', 'embed', 'reembed', 'delete'];

export function AuditClient() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [stats, setStats] = useState<AuditStat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opFilter, setOpFilter] = useState<Set<AuditRow['op']>>(new Set(ALL_OPS));
  const [memoryFilter, setMemoryFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: '200',
      include_stats: '1',
    });
    if (memoryFilter.trim()) params.set('memory_id', memoryFilter.trim());

    fetch(`/api/audit?${params.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`audit ${res.status}`);
        return (await res.json()) as AuditResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setStats(data.stats ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load audit');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [memoryFilter]);

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => opFilter.has(r.op)),
    [rows, opFilter]
  );

  function toggleOp(op: AuditRow['op']) {
    setOpFilter((prev) => {
      const next = new Set(prev);
      if (next.has(op)) next.delete(op);
      else next.add(op);
      // never let the filter go empty — that's just an empty list
      if (next.size === 0) return new Set(ALL_OPS);
      return next;
    });
  }

  return (
    <main className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
      <header className="mb-10">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-2">
          Audit
        </p>
        <h1 className="font-serif text-4xl text-cream">
          Every read, every write, every forget.
        </h1>
        <p className="text-cream/60 leading-relaxed mt-3 max-w-2xl">
          The append-only ledger of operations on your archive. Survives forgets — a deleted
          memory&apos;s history stays here so you can answer &ldquo;what happened?&rdquo; long after the row is gone.
        </p>
      </header>

      {stats && stats.length > 0 && (
        <section className="mb-10 grid grid-cols-2 md:grid-cols-5 gap-3">
          {ALL_OPS.map((op) => {
            const s = stats.find((x) => x.op === op);
            const total = s?.total ?? 0;
            return (
              <button
                key={op}
                type="button"
                onClick={() => toggleOp(op)}
                className={`flex flex-col gap-1 px-4 py-4 rounded-xl border text-left transition ${
                  opFilter.has(op)
                    ? 'border-amber/40 bg-cream/[0.04]'
                    : 'border-cream/8 bg-cream/[0.01] opacity-50'
                }`}
              >
                <span className={`font-mono text-[10px] uppercase tracking-widest ${OP_COLOR[op]}`}>
                  {OP_LABEL[op]}
                </span>
                <span className="font-serif text-3xl text-cream leading-none">{total}</span>
                <span className="font-mono text-[10px] text-cream/30 mt-1">
                  {s?.lastAt ? `last: ${ago(s.lastAt)}` : 'no activity'}
                </span>
              </button>
            );
          })}
        </section>
      )}

      <section className="mb-6 flex items-center gap-3">
        <input
          type="text"
          value={memoryFilter}
          onChange={(e) => setMemoryFilter(e.target.value)}
          placeholder="filter by memory id (uuid)"
          className="flex-1 max-w-md px-4 py-2.5 rounded-lg border border-cream/10 bg-cream/[0.02] font-mono text-[12px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-amber/40"
        />
        {memoryFilter && (
          <button
            type="button"
            onClick={() => setMemoryFilter('')}
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

      {!loading && !error && filtered.length === 0 && (
        <div className="px-8 py-16 rounded-xl border border-cream/8 bg-cream/[0.02] text-center">
          <p className="font-serif text-2xl text-cream/70">Nothing yet.</p>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mt-3">
            Capture or recall a memory to see it here.
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <ol className="flex flex-col gap-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[88px_72px_1fr_120px_100px] gap-4 items-start px-4 py-3 rounded-lg border border-cream/6 bg-cream/[0.015] hover:bg-cream/[0.03] transition"
            >
              <span className={`font-mono text-[10px] uppercase tracking-widest ${OP_COLOR[r.op]}`}>
                {OP_LABEL[r.op]}
              </span>
              <span className="font-mono text-[10px] text-cream/40">{shortId(r.memoryId)}</span>
              <span className="font-mono text-[11px] text-cream/70 break-all">
                {r.query ? (
                  <>&ldquo;{r.query.length > 100 ? r.query.slice(0, 100) + '…' : r.query}&rdquo;</>
                ) : r.mime && r.mime !== 'text/plain' ? (
                  <span className="text-amber/70">{r.mime}</span>
                ) : (
                  <span className="text-cream/30">—</span>
                )}
              </span>
              <span className="font-mono text-[10px] text-cream/40 truncate">
                {r.caller ? r.caller.slice(0, 16) : <span className="text-cream/20">—</span>}
              </span>
              <span className="font-mono text-[10px] text-cream/40 text-right">
                {ago(r.createdAt)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
