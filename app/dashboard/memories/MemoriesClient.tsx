'use client';

// Archive filter bar + selectable list. Filters push to the URL (so refresh /
// back keep state). Bulk delete is a POST to /api/memories/bulk-delete behind
// a confirm modal — no quiet deletions. Export all streams .jsonl from
// /api/memories/export.

import { useCallback, useMemo, useState, useTransition, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export type MemoryRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
};

export type MemoriesFilters = {
  q: string | null;
  source: string | null;
  from: string | null;
  to: string | null;
  tag: string | null;
  page: number;
};

type Props = {
  filters: MemoriesFilters;
  rows: MemoryRow[];
  total: number;
  pageSize: number;
  pageCount: number;
  sources: string[];
  tags: string[];
};

function groupByDay(memories: MemoryRow[]): [string, MemoryRow[]][] {
  const groups = new Map<string, MemoryRow[]>();
  for (const m of memories) {
    const day = m.created_at.slice(0, 10);
    const arr = groups.get(day) ?? [];
    arr.push(m);
    groups.set(day, arr);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatDay(day: string): string {
  const date = new Date(day + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(11, 16);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function MemoriesClient({
  filters,
  rows,
  total,
  pageSize,
  pageCount,
  sources,
  tags,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeEmbeddings, setIncludeEmbeddings] = useState(false);
  const [exporting, setExporting] = useState(false);

  const groups = useMemo(() => groupByDay(rows), [rows]);
  const hasActiveFilters =
    Boolean(filters.q) ||
    Boolean(filters.source) ||
    Boolean(filters.from) ||
    Boolean(filters.to) ||
    Boolean(filters.tag);

  const buildUrl = useCallback(
    (updates: Partial<Record<'q' | 'source' | 'from' | 'to' | 'tag' | 'page', string | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const s = next.toString();
      return s ? `?${s}` : '';
    },
    [searchParams]
  );

  function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = buildUrl({
      q: (form.get('q') as string) || null,
      source: (form.get('source') as string) || null,
      from: (form.get('from') as string) || null,
      to: (form.get('to') as string) || null,
      tag: (form.get('tag') as string) || null,
      page: null,
    });
    startTransition(() => router.push(`/dashboard/memories${url}`));
  }

  function onClearFilters() {
    startTransition(() => router.push('/dashboard/memories'));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOnPage = rows.every((r) => next.has(r.id));
      if (allOnPage) {
        for (const r of rows) next.delete(r.id);
      } else {
        for (const r of rows) next.add(r.id);
      }
      return next;
    });
  }

  async function onConfirmDelete() {
    if (selected.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/memories/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; deleted?: number };
      if (!res.ok) {
        setError(data.error ?? 'Could not delete memories.');
        return;
      }
      setSelected(new Set());
      setConfirming(false);
      startTransition(() => router.refresh());
    } finally {
      setDeleting(false);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (includeEmbeddings) qs.set('include_embeddings', 'true');
      if (filters.q) qs.set('q', filters.q);
      if (filters.source) qs.set('source', filters.source);
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.tag) qs.set('tag', filters.tag);
      const url = '/api/memories/export' + (qs.toString() ? `?${qs}` : '');
      window.location.href = url;
    } finally {
      setTimeout(() => setExporting(false), 600);
    }
  }

  const start = total === 0 ? 0 : (filters.page - 1) * pageSize + 1;
  const end = Math.min(total, filters.page * pageSize);

  return (
    <div className="flex flex-col gap-10">
      <form
        onSubmit={onFilterSubmit}
        className="border border-cream/10 bg-cream/[0.02] rounded-xl p-6 flex flex-col gap-5"
      >
        <div>
          <label htmlFor="q" className="sr-only">Search memories</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q ?? ''}
            placeholder="Search your memory — what did I tell it about the launch?"
            className="w-full bg-transparent border-b border-cream/15 focus:border-amber/60 focus:outline-none py-2 text-lg placeholder:text-cream/25 transition-colors duration-[480ms]"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <FilterField label="Source">
            <select
              name="source"
              defaultValue={filters.source ?? ''}
              className="w-full bg-night border border-cream/10 rounded-md px-3 py-2 text-sm text-cream focus:outline-none focus:border-amber/40"
            >
              <option value="">All</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Tag">
            <select
              name="tag"
              defaultValue={filters.tag ?? ''}
              className="w-full bg-night border border-cream/10 rounded-md px-3 py-2 text-sm text-cream focus:outline-none focus:border-amber/40"
            >
              <option value="">All</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="From">
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ''}
              className="w-full bg-night border border-cream/10 rounded-md px-3 py-2 text-sm text-cream focus:outline-none focus:border-amber/40"
            />
          </FilterField>
          <FilterField label="To">
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ''}
              className="w-full bg-night border border-cream/10 rounded-md px-3 py-2 text-sm text-cream focus:outline-none focus:border-amber/40"
            />
          </FilterField>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-amber text-night px-5 py-2 font-sans font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {pending ? 'Filtering…' : 'Filter'}
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="font-mono text-[11px] uppercase tracking-widest text-cream/50 hover:text-amber transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
            {total.toLocaleString()} memor{total === 1 ? 'y' : 'ies'}
            {hasActiveFilters ? ' matching' : ' total'}
          </p>
        </div>
      </form>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePage}
            disabled={rows.length === 0}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors disabled:opacity-40"
          >
            {rows.every((r) => selected.has(r.id)) && rows.length > 0
              ? 'Deselect page'
              : 'Select page'}
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-cream/30">·</span>
              <span className="font-mono text-[11px] uppercase tracking-widest text-amber">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-red-300 transition-colors"
              >
                Delete {selected.size}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-cream/50">
            <input
              type="checkbox"
              checked={includeEmbeddings}
              onChange={(e) => setIncludeEmbeddings(e.target.checked)}
              className="accent-amber"
            />
            Include embeddings
          </label>
          <button
            type="button"
            onClick={onExport}
            disabled={exporting}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export all (.jsonl)'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/5 text-red-200/90 text-sm px-5 py-4">
          {error}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="py-20 border border-cream/10 text-center">
          <p className="font-serif text-3xl md:text-4xl text-cream mb-3">
            {hasActiveFilters ? 'Nothing matches that filter.' : 'No memories yet.'}
          </p>
          <p className="text-cream/50 max-w-md mx-auto mb-8">
            {hasActiveFilters
              ? 'Widen the search or clear the filters.'
              : 'Mint a key, point Claude Code at it, and start talking. Every turn becomes a memory.'}
          </p>
          {!hasActiveFilters && (
            <pre className="inline-block font-mono text-sm bg-cream/[0.04] border border-cream/10 text-amber px-4 py-3">
              <span className="text-cream/40 select-none">$ </span>npx spine-mcp init
            </pre>
          )}
        </div>
      ) : (
        <div className="space-y-16">
          {groups.map(([day, items]) => (
            <section key={day}>
              <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-6">
                {formatDay(day)}
              </p>
              <ul className="space-y-6">
                {items.map((m) => {
                  const isSelected = selected.has(m.id);
                  return (
                    <li
                      key={m.id}
                      className={
                        'border-l-2 pl-6 py-1 flex gap-4 transition-colors duration-[480ms] ' +
                        (isSelected ? 'border-amber' : 'border-amber/40')
                      }
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(m.id)}
                        className="mt-[0.45em] accent-amber shrink-0"
                        aria-label={`Select memory from ${formatTime(m.created_at)}`}
                      />
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-2">
                          {formatTime(m.created_at)}
                          {m.source ? ` · ${m.source}` : ''}
                        </p>
                        <p className="font-serif text-lg md:text-xl text-cream/90 leading-relaxed break-words whitespace-pre-wrap">
                          {m.content}
                        </p>
                        {m.tags && m.tags.length > 0 && (
                          <p className="mt-3 font-mono text-[11px] text-cream/40">
                            {m.tags.map((t) => `#${t}`).join(' ')}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-between pt-6 border-t border-cream/10">
          <PageLink
            label="← Previous"
            disabled={filters.page <= 1}
            href={`/dashboard/memories${buildUrl({ page: filters.page > 2 ? String(filters.page - 1) : null })}`}
          />
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
            {start.toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
            <span className="text-cream/25"> · page {filters.page} / {pageCount}</span>
          </p>
          <PageLink
            label="Next →"
            disabled={filters.page >= pageCount}
            href={`/dashboard/memories${buildUrl({ page: String(filters.page + 1) })}`}
          />
        </nav>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-night/80 backdrop-blur-sm px-6"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="relative max-w-md w-full rounded-2xl border border-cream/15 bg-night px-7 py-8"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-3">
              Hard delete
            </p>
            <h2 className="font-serif text-3xl text-cream mb-4">
              Delete {selected.size} memor{selected.size === 1 ? 'y' : 'ies'}.
            </h2>
            <p className="text-cream/60 text-sm leading-relaxed mb-8">
              This is permanent. The rows, embeddings, and full-text entries are removed. Spine
              has no undo for this — we only ever forget what you explicitly ask us to.
            </p>
            <div className="flex items-center gap-4 justify-end">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-cream transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-400/90 text-night px-5 py-2 font-sans font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : `Delete ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-2">{label}</p>
      {children}
    </div>
  );
}

function PageLink({ label, href, disabled }: { label: string; href: string; disabled: boolean }) {
  if (disabled) {
    return (
      <span className="font-mono text-[11px] uppercase tracking-widest text-cream/20">{label}</span>
    );
  }
  return (
    <a
      href={href}
      className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors"
    >
      {label}
    </a>
  );
}
