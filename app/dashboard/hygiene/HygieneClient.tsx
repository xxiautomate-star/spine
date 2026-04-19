'use client';

// Three-panel hygiene UI: clusters, duplicates, stale candidates. Free plan
// sees the insights but all action buttons (scan / merge / delete) are
// disabled with a gentle upgrade nudge. Pro and Power get the full surface.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Plan } from '@/lib/auth';
import type { ClusterSummary, DuplicatePair, StaleMemory } from '@/lib/hygiene';

type PageData = {
  plan: Plan;
  clusters: ClusterSummary[];
  duplicates: DuplicatePair[];
  stale: StaleMemory[];
  totalMemories: number;
};

type Action = 'keep_a' | 'keep_b' | 'keep_both';

export function HygieneClient({ data }: { data: PageData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [busyPair, setBusyPair] = useState<string | null>(null);
  const [busyStale, setBusyStale] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'good' | 'bad'; msg: string } | null>(null);

  const isPaid = data.plan === 'pro' || data.plan === 'power';

  function flash(kind: 'good' | 'bad', msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4500);
  }

  async function onScan() {
    if (!isPaid) return;
    setScanning(true);
    try {
      const res = await fetch('/api/hygiene/dedupe/scan', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as {
        inserted?: number;
        scanned?: number;
        error?: string;
      };
      if (!res.ok) {
        flash('bad', body.error ?? 'Scan failed.');
        return;
      }
      flash(
        'good',
        body.inserted
          ? `Found ${body.inserted} new possible duplicate${body.inserted === 1 ? '' : 's'}.`
          : 'No new duplicates found.'
      );
      startTransition(() => router.refresh());
    } finally {
      setScanning(false);
    }
  }

  async function onResolvePair(pairId: string, action: Action) {
    if (!isPaid) return;
    setBusyPair(pairId);
    try {
      const res = await fetch('/api/hygiene/dedupe/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair_id: pairId, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        flash('bad', body.error ?? 'Could not resolve pair.');
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusyPair(null);
    }
  }

  async function onDeleteStale(id: string) {
    if (!isPaid) return;
    setBusyStale(id);
    try {
      const res = await fetch('/api/memories/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        flash('bad', body.error ?? 'Could not delete memory.');
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusyStale(null);
    }
  }

  return (
    <div className="flex flex-col gap-16">
      {toast && (
        <div
          role="status"
          className={
            'rounded-xl border px-5 py-4 text-sm transition-opacity duration-500 ' +
            (toast.kind === 'good'
              ? 'border-amber/30 bg-amber/5 text-cream'
              : 'border-red-400/30 bg-red-400/5 text-red-200/90')
          }
        >
          {toast.msg}
        </div>
      )}

      {!isPaid && (
        <div className="rounded-2xl border border-cream/10 bg-cream/[0.02] px-6 py-5 flex items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-2">
              Read-only on Free
            </p>
            <p className="text-cream/70 text-sm max-w-xl leading-relaxed">
              Insights on Free. Acting on them — scanning for duplicates, merging pairs, deleting
              stale memories — is a Pro feature. Your archive stays intact either way.
            </p>
          </div>
          <a
            href="/dashboard/billing"
            className="shrink-0 self-center font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors"
          >
            Upgrade →
          </a>
        </div>
      )}

      <Section
        number="A"
        label="Clusters"
        headline="Topics the archive is forming around."
        body="Every capture joins a nearest-neighbour cluster if the cosine similarity is above 0.78 — otherwise it seeds a new one. Labels are guessed from the first member; rename freely by capturing more."
      >
        {data.clusters.length === 0 ? (
          <EmptyPanel>No clusters yet. Capture a handful of memories and come back.</EmptyPanel>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.clusters.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-cream/10 bg-cream/[0.02] px-5 py-4 flex items-baseline justify-between gap-4"
              >
                <span className="font-serif text-lg text-cream truncate">#{c.label}</span>
                <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40 shrink-0">
                  {c.size.toLocaleString()} memor{c.size === 1 ? 'y' : 'ies'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        number="B"
        label="Duplicates"
        headline={
          data.duplicates.length > 0
            ? `${data.duplicates.length} possible duplicate${data.duplicates.length === 1 ? '' : 's'}.`
            : 'Nothing flagged as a duplicate.'
        }
        body="Pairs with cosine similarity above 0.92. Merge keeps one, drops the other; or keep both if you meant to write both."
        action={
          <button
            type="button"
            onClick={onScan}
            disabled={!isPaid || scanning}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors disabled:opacity-40"
          >
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
        }
      >
        {data.duplicates.length === 0 ? (
          <EmptyPanel>
            {isPaid
              ? 'Hit “Scan now” to rerun detection.'
              : 'Pro scans the corpus for duplicates on demand.'}
          </EmptyPanel>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.duplicates.map((pair) => (
              <li
                key={pair.id}
                className="rounded-xl border border-cream/10 bg-cream/[0.02] p-5"
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
                    Similarity {(pair.similarity * 100).toFixed(1)}%
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-cream/30">
                    Detected {new Date(pair.detected_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                  <DupeCell memory={pair.a} />
                  <DupeCell memory={pair.b} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <PairAction
                    label="Keep A, drop B"
                    onClick={() => onResolvePair(pair.id, 'keep_a')}
                    disabled={!isPaid || busyPair === pair.id}
                  />
                  <PairAction
                    label="Keep B, drop A"
                    onClick={() => onResolvePair(pair.id, 'keep_b')}
                    disabled={!isPaid || busyPair === pair.id}
                  />
                  <PairAction
                    label="Keep both"
                    variant="ghost"
                    onClick={() => onResolvePair(pair.id, 'keep_both')}
                    disabled={!isPaid || busyPair === pair.id}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        number="C"
        label="Stale"
        headline={
          data.stale.length > 0
            ? `${data.stale.length} never-opened memor${data.stale.length === 1 ? 'y' : 'ies'}.`
            : 'Nothing has gone stale.'
        }
        body="At least 30 days old and never retrieved. Not automatically deleted — Spine is append-only; only you decide."
      >
        {data.stale.length === 0 ? (
          <EmptyPanel>
            Either your archive is very fresh, or every memory has been useful. Either is fine.
          </EmptyPanel>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.stale.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-cream/10 bg-cream/[0.02] px-5 py-4 flex items-start gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-2">
                    {m.days_old} day{m.days_old === 1 ? '' : 's'} old
                    {m.source ? ` · ${m.source}` : ''}
                  </p>
                  <p className="font-serif text-base text-cream/90 leading-relaxed break-words whitespace-pre-wrap">
                    {m.content.length > 240 ? `${m.content.slice(0, 240)}…` : m.content}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteStale(m.id)}
                  disabled={!isPaid || busyStale === m.id}
                  className="shrink-0 self-center font-mono text-[11px] uppercase tracking-widest text-cream/50 hover:text-red-300 transition-colors disabled:opacity-40"
                >
                  {busyStale === m.id ? 'Deleting…' : 'Delete'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  number,
  label,
  headline,
  body,
  action,
  children,
}: {
  number: string;
  label: string;
  headline: string;
  body: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber">
          § 005.{number} &middot; {label}
        </p>
        {action}
      </div>
      <h2 className="font-serif text-3xl md:text-4xl text-cream mb-3">{headline}</h2>
      <p className="text-cream/60 text-base max-w-2xl leading-relaxed mb-8">{body}</p>
      {children}
    </section>
  );
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-cream/10 bg-cream/[0.02] px-6 py-8 text-center text-cream/50 text-sm">
      {children}
    </div>
  );
}

function DupeCell({
  memory,
}: {
  memory: { id: string; content: string; source: string | null; created_at: string };
}) {
  return (
    <div className="border border-cream/10 rounded-lg px-4 py-3">
      <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-2">
        {new Date(memory.created_at).toLocaleDateString()}
        {memory.source ? ` · ${memory.source}` : ''}
      </p>
      <p className="font-serif text-sm text-cream/90 leading-relaxed whitespace-pre-wrap break-words">
        {memory.content.length > 240 ? `${memory.content.slice(0, 240)}…` : memory.content}
      </p>
    </div>
  );
}

function PairAction({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant?: 'ghost';
}) {
  const base =
    'font-mono text-[11px] uppercase tracking-widest transition-colors disabled:opacity-40 ';
  const tone =
    variant === 'ghost'
      ? 'text-cream/50 hover:text-cream'
      : 'text-cream/60 hover:text-amber';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={base + tone}>
      {label}
    </button>
  );
}
