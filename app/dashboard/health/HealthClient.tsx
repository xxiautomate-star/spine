'use client';

import { useEffect, useState } from 'react';
import type { HealthStats, DayCount, DuplicateCluster } from '@/app/api/health/stats/route';

// ── Heatmap ───────────────────────────────────────────────────────────────────

function buildCalendar(byDate: DayCount[]): { day: string; count: number }[] {
  const map = new Map(byDate.map((d) => [d.day, d.count]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: { day: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, count: map.get(key) ?? 0 });
  }
  return days;
}

function heatColor(count: number): string {
  if (count === 0) return 'bg-cream/5';
  if (count <= 2) return 'bg-amber/20';
  if (count <= 6) return 'bg-amber/50';
  if (count <= 15) return 'bg-amber/80';
  return 'bg-amber';
}

function Heatmap({ byDate }: { byDate: DayCount[] }) {
  const days = buildCalendar(byDate);
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40">
        Last 30 days
      </p>
      <div className="flex gap-1 flex-wrap">
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.count} memories`}
            className={`w-[18px] h-[18px] rounded-[3px] transition-all duration-200 hover:ring-1 hover:ring-amber/60 ${heatColor(d.count)}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="font-mono text-[9px] text-cream/30">Less</span>
        {['bg-cream/5', 'bg-amber/20', 'bg-amber/50', 'bg-amber/80', 'bg-amber'].map((c) => (
          <div key={c} className={`w-3 h-3 rounded-[2px] ${c}`} />
        ))}
        <span className="font-mono text-[9px] text-cream/30">More</span>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 px-6 py-5 rounded-xl border border-cream/8 bg-cream/[0.02]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40">{label}</p>
      <p className={`font-serif text-4xl leading-none ${accent ? 'text-amber' : 'text-cream'}`}>
        {value}
      </p>
      {sub && <p className="font-mono text-[11px] text-cream/30 mt-1">{sub}</p>}
    </div>
  );
}

// ── Coverage ring ─────────────────────────────────────────────────────────────

function CoverageRing({ pct }: { pct: number }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-5 rounded-xl border border-cream/8 bg-cream/[0.02]">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 self-start">
        30-day coverage
      </p>
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(232,228,221,0.05)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#E89A3C"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          style={{ transition: 'stroke-dasharray 1s ease' }}
        />
      </svg>
      <p className="font-serif text-3xl -mt-14 text-cream">{pct}%</p>
      <p className="font-mono text-[11px] text-cream/30">of days captured</p>
    </div>
  );
}

// ── Duplicate cluster list ─────────────────────────────────────────────────────

function DupList({ clusters }: { clusters: DuplicateCluster[] }) {
  if (clusters.length === 0) {
    return (
      <p className="font-mono text-[12px] text-cream/30 py-4">
        No near-duplicates detected.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-cream/5">
      {clusters.map((c) => (
        <div key={`${c.memory_id}-${c.duplicate_id}`} className="py-4 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber/10 text-amber">
              {(c.similarity * 100).toFixed(0)}% similar
            </span>
            <span className="font-mono text-[10px] text-cream/30">
              {c.created_at ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            </span>
          </div>
          <p className="font-mono text-[11px] text-cream/50 leading-relaxed line-clamp-2">
            {c.content_preview}
          </p>
          <p className="font-mono text-[11px] text-cream/30 leading-relaxed line-clamp-2 border-l border-cream/10 pl-3">
            {c.dup_preview}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function HealthClient() {
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health/stats')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<HealthStats>;
      })
      .then(setStats)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Failed to load stats')
      );
  }, []);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20">
        <p className="font-mono text-[12px] text-red-400">Error: {error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-amber/50 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-14 flex flex-col gap-10">
      {/* Header */}
      <div>
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-3">
          Memory Health
        </p>
        <h1 className="font-serif text-5xl text-cream leading-tight">
          {stats.total.toLocaleString()} memories.
        </h1>
        <p className="text-cream/40 mt-3 leading-relaxed max-w-lg">
          The full archive of your AI&apos;s memory. Orphaned chunks have never been recalled
          and have no entity links — candidates for hygiene.
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Total" value={stats.total.toLocaleString()} accent />
        <Stat label="Graph edges" value={stats.edge_count.toLocaleString()} sub="memory → memory links" />
        <Stat label="Orphans" value={stats.orphan_count.toLocaleString()} sub="never recalled · no links" />
        <Stat label="Duplicates" value={stats.duplicate_clusters.length} sub="≥90% similarity" />
      </div>

      {/* Heatmap + coverage */}
      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="px-6 py-5 rounded-xl border border-cream/8 bg-cream/[0.02]">
          <Heatmap byDate={stats.by_date} />
        </div>
        <CoverageRing pct={stats.coverage_pct} />
      </div>

      {/* Duplicate clusters */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-cream">Near-duplicate clusters</h2>
          <span className="font-mono text-[10px] text-cream/30">
            {stats.duplicate_clusters.length} pairs · ≥90% similar
          </span>
        </div>
        <div className="rounded-xl border border-cream/8 bg-cream/[0.02] px-6">
          <DupList clusters={stats.duplicate_clusters} />
        </div>
      </div>

      {/* Orphan explanation */}
      {stats.orphan_count > 0 && (
        <div className="rounded-xl border border-amber/20 bg-amber/5 px-6 py-5 flex flex-col gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber">
            {stats.orphan_count} orphaned chunks
          </p>
          <p className="text-cream/50 text-sm leading-relaxed">
            These memories have never appeared in a recall result and share no entity links with
            other memories. They may be low-signal session noise. Run hygiene to review and prune.
          </p>
          <a
            href="/dashboard/hygiene"
            className="self-start font-mono text-[11px] text-amber/70 hover:text-amber mt-1 underline underline-offset-4"
          >
            Open hygiene →
          </a>
        </div>
      )}
    </div>
  );
}
