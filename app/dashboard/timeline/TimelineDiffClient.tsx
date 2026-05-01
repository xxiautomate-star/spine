'use client';

// TimelineDiffClient — Gate C slider UI.
//
// The component takes no props (auth + user are validated at the page
// level). All state is local. On mount it fetches the default range
// (last 7 days). On slider drag it debounces + refetches.
//
// Demo flow Roman should be able to record in 10 seconds:
//   1. Open /dashboard/timeline
//   2. The two-panel diff already shows "Mon → today"
//   3. Drag the left thumb back to a month ago
//   4. The right panel updates — "32 memories added · 4 decisions"
//   5. Click an entity chip ("Suburban Shine") to filter
//   6. The diff narrows to that project only

import { useEffect, useMemo, useRef, useState } from 'react';

// ── Types (mirror /api/timeline-diff response) ────────────────────────
type DiffMemory = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  type: string;
  createdAt: string;
  signalTier: string | null;
};
type Snapshot = {
  cutoff: string;
  totalCount: number;
  byType: Record<string, number>;
  recent: DiffMemory[];
};
type DiffResponse = {
  from: string;
  to: string;
  entity: string | null;
  snapshot1: Snapshot;
  snapshot2: Snapshot;
  diff: {
    added: DiffMemory[];
    addedCount: number;
    truncated: boolean;
    byType: Record<string, number>;
    decisions: DiffMemory[];
  };
};

// ── Time helpers ──────────────────────────────────────────────────────
const ONE_DAY_MS = 86_400_000;
const PRESETS: Array<{ label: string; days: number }> = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  decision: { label: 'decision', color: '#E89A3C', bg: 'rgba(232,154,60,0.12)' },
  bug: { label: 'bug fix', color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
  feature: { label: 'feature', color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
  context: { label: 'context', color: '#60A5FA', bg: 'rgba(96,165,250,0.10)' },
  fact: { label: 'fact', color: '#A78BFA', bg: 'rgba(167,139,250,0.10)' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TimelineDiffClient() {
  const now = useMemo(() => Date.now(), []);
  const [t2, setT2] = useState<number>(now);
  const [t1, setT1] = useState<number>(now - 7 * ONE_DAY_MS);
  const [entity, setEntity] = useState<string>('');
  const [data, setData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const fetchSeq = useRef(0);

  // Debounced fetch on slider/entity change.
  useEffect(() => {
    const seq = ++fetchSeq.current;
    const handle = window.setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams({
          t1: new Date(t1).toISOString(),
          t2: new Date(t2).toISOString(),
        });
        if (entity.trim()) params.set('entity', entity.trim());
        const res = await fetch(`/api/timeline-diff?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as DiffResponse;
        if (fetchSeq.current === seq) {
          setData(body);
          setLoading(false);
        }
      } catch (caught) {
        if (fetchSeq.current === seq) {
          setErr(caught instanceof Error ? caught.message : 'Failed to load.');
          setLoading(false);
        }
      }
    }, 220); // debounce window — slider drag fires many times
    return () => window.clearTimeout(handle);
  }, [t1, t2, entity]);

  // The slider's full range is "30 days back to now" by default. When the
  // user picks a preset, we anchor t1 = now - days, t2 = now.
  const rangeMin = now - 90 * ONE_DAY_MS;
  const rangeMax = now;

  return (
    <main className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD] px-6 md:px-10 pt-12 pb-24">
      <header className="max-w-6xl mx-auto mb-12">
        <p className="font-mono text-[10px] uppercase tracking-widest text-amber/80 mb-3">
          § Timeline diff · visual proof of memory
        </p>
        <h1 className="font-serif text-4xl md:text-6xl tracking-tight leading-[1.05]">
          What did Spine know{' '}
          <em className="italic text-amber">then</em>, vs <em className="italic text-amber">now</em>?
        </h1>
        <p className="mt-6 max-w-2xl text-cream/55 leading-relaxed">
          Drag the slider. Two snapshots, one diff. New memories, new
          decisions, conflicts resolved between the two cutoffs — all
          in one frame. Filter by a project name or person to narrow
          the view.
        </p>
      </header>

      <section className="max-w-6xl mx-auto mb-10">
        {/* Controls — preset + entity filter + slider */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="font-mono text-[10px] uppercase tracking-widest text-cream/35">
            Window
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setT2(now);
                setT1(now - p.days * ONE_DAY_MS);
              }}
              className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-cream/[0.10] text-cream/65 hover:border-amber/40 hover:text-amber transition-colors duration-300"
            >
              {p.label}
            </button>
          ))}
          <div className="flex-1 min-w-[200px]" />
          <input
            type="text"
            placeholder="filter — project name, person, tag…"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            className="bg-transparent border-b border-cream/15 focus:border-amber focus:outline-none px-1 py-1 font-mono text-[12px] text-cream/85 placeholder:text-cream/25 min-w-[260px]"
          />
        </div>

        {/* Slider — two thumbs, native range inputs stacked */}
        <div className="relative h-12 mb-6 select-none">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-cream/[0.10]" />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-amber/60"
            style={{
              left: `${((t1 - rangeMin) / (rangeMax - rangeMin)) * 100}%`,
              width: `${((t2 - t1) / (rangeMax - rangeMin)) * 100}%`,
            }}
          />
          <input
            type="range"
            min={rangeMin}
            max={rangeMax}
            step={ONE_DAY_MS / 24} // ≈ 1-hour resolution
            value={t1}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              if (next < t2) setT1(next);
            }}
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full bg-transparent appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-amber [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
            aria-label="Earlier cutoff"
          />
          <input
            type="range"
            min={rangeMin}
            max={rangeMax}
            step={ONE_DAY_MS / 24}
            value={t2}
            onChange={(e) => {
              const next = parseInt(e.target.value, 10);
              if (next > t1) setT2(next);
            }}
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full bg-transparent appearance-none pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cream [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cream [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
            aria-label="Later cutoff"
          />
        </div>

        <div className="flex justify-between font-mono text-[11px] text-cream/55">
          <span>
            <span className="text-amber">●</span> {fmtDate(new Date(t1).toISOString())}
          </span>
          <span>
            <span className="text-cream/85">●</span> {fmtDate(new Date(t2).toISOString())}
          </span>
        </div>
      </section>

      {/* Two-panel snapshot view */}
      <section className="max-w-6xl mx-auto grid md:grid-cols-2 gap-5 mb-10">
        <SnapshotPanel
          accent="amber"
          title="Then"
          snapshot={data?.snapshot1}
          loading={loading}
        />
        <SnapshotPanel
          accent="cream"
          title="Now"
          snapshot={data?.snapshot2}
          loading={loading}
        />
      </section>

      {/* Diff highlights */}
      <section className="max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-serif text-2xl text-cream">What changed</h2>
          {data && (
            <p className="font-mono text-[11px] text-cream/45">
              {data.diff.addedCount.toLocaleString()} memories added
              {data.diff.truncated && ' · truncated at 200'} ·{' '}
              {data.diff.decisions.length} decisions
            </p>
          )}
        </div>

        {err && (
          <div className="border border-red-400/30 bg-red-400/[0.04] p-4 rounded-lg text-red-300/80 font-mono text-sm">
            {err}
          </div>
        )}

        {data && data.diff.addedCount === 0 && !err && (
          <p className="font-serif text-cream/40 italic">
            Nothing landed in this window. Try widening the range.
          </p>
        )}

        {data && data.diff.decisions.length > 0 && (
          <div className="mb-8">
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/70 mb-3">
              Decisions
            </p>
            <ul className="space-y-3">
              {data.diff.decisions.map((m) => (
                <li
                  key={m.id}
                  className="border-l-2 border-amber/60 pl-4 py-1 text-cream/85"
                >
                  <p className="text-[15px] leading-relaxed">{m.content}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-cream/35">
                    {fmtDate(m.createdAt)} {m.source ? `· ${m.source}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data && data.diff.added.length > 0 && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45 mb-3">
              All additions ({data.diff.added.length})
            </p>
            <ul className="space-y-2">
              {data.diff.added.slice(0, 50).map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-3 border-b border-cream/[0.05] pb-3"
                >
                  <span
                    className="font-mono text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 shrink-0"
                    style={{
                      color: TYPE_META[m.type]?.color ?? '#E8E4DD',
                      backgroundColor: TYPE_META[m.type]?.bg ?? 'rgba(232,228,221,0.05)',
                    }}
                  >
                    {TYPE_META[m.type]?.label ?? m.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-cream/85 leading-snug">
                      {m.content.length > 240
                        ? m.content.slice(0, 240) + '…'
                        : m.content}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-cream/30">
                      {fmtDate(m.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function SnapshotPanel({
  accent,
  title,
  snapshot,
  loading,
}: {
  accent: 'amber' | 'cream';
  title: string;
  snapshot: Snapshot | undefined;
  loading: boolean;
}) {
  const dotClass = accent === 'amber' ? 'bg-amber' : 'bg-cream';
  return (
    <div className="border border-cream/[0.08] rounded-xl p-6 bg-cream/[0.02]">
      <div className="flex items-center gap-2 mb-2">
        <span className={`block w-2 h-2 rounded-full ${dotClass}`} />
        <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45">
          {title}
        </p>
      </div>
      <p className="font-mono text-[11px] text-cream/35 mb-4">
        {snapshot ? fmtDate(snapshot.cutoff) : '—'}
      </p>
      <div className="flex items-baseline gap-3 mb-6">
        <span className="font-serif text-5xl text-cream">
          {loading && !snapshot ? '…' : (snapshot?.totalCount ?? 0).toLocaleString()}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
          memories
        </span>
      </div>

      {snapshot && (
        <div className="grid grid-cols-5 gap-2 mb-6">
          {Object.entries(snapshot.byType).map(([type, n]) => (
            <div key={type} className="text-center">
              <p
                className="font-serif text-xl"
                style={{ color: TYPE_META[type]?.color ?? '#E8E4DD' }}
              >
                {n}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-widest text-cream/30">
                {type}
              </p>
            </div>
          ))}
        </div>
      )}

      {snapshot && snapshot.recent.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45 mb-3">
            Most recent
          </p>
          <ul className="space-y-2 text-[12px] text-cream/65 leading-snug">
            {snapshot.recent.slice(0, 5).map((m) => (
              <li key={m.id} className="border-l border-cream/[0.10] pl-3">
                {m.content.length > 140 ? m.content.slice(0, 140) + '…' : m.content}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
