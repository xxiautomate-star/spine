// Server component: renders the archive with filters + pagination. Filters
// drive URL query params so links are shareable and the Back button does the
// right thing. The MemoriesClient handles selection + bulk delete + export
// entirely on top of the server-rendered list.

import Link from 'next/link';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { MemoriesClient, type MemoryRow, type MemoriesFilters } from './MemoriesClient';

// Brief 023 — signal-tier filter pill. Three accents: amber (high),
// cream (standard), muted (low/legacy). Click navigates with the tier
// query-string preserved alongside any other active filter.
function TierPill({
  label,
  count,
  href,
  active,
  accent,
  hint,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
  accent: 'amber' | 'cream' | 'muted';
  hint: string;
}) {
  const numberColour =
    accent === 'amber' ? 'text-amber' : accent === 'cream' ? 'text-cream' : 'text-cream/40';
  const labelColour = active ? 'text-cream' : 'text-cream/55 hover:text-cream';
  const dotColour =
    accent === 'amber' ? 'bg-amber' : accent === 'cream' ? 'bg-cream/60' : 'bg-cream/25';
  return (
    <Link
      href={href}
      className={`group inline-flex flex-col gap-1 ${active ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
      aria-current={active ? 'true' : undefined}
    >
      <span className={`font-serif text-3xl md:text-4xl tracking-tight ${numberColour}`}>
        {count.toLocaleString()}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`w-[5px] h-[5px] rounded-full ${dotColour}`} aria-hidden />
        <span className={`font-mono text-[10px] uppercase tracking-widest transition-colors ${labelColour}`}>
          {label}
        </span>
      </span>
      <span className="font-mono text-[9.5px] text-cream/30 max-w-[160px]">{hint}</span>
    </Link>
  );
}

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SearchParamValue = string | string[] | undefined;
type SearchParams = Record<string, SearchParamValue>;

function firstParam(value: SearchParamValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toIntOrDefault(value: SearchParamValue, fallback: number): number {
  const raw = firstParam(value);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

type TierFilter = 'high' | 'standard' | 'low' | null;
function parseTier(raw: SearchParamValue): TierFilter {
  const v = firstParam(raw);
  return v === 'high' || v === 'standard' || v === 'low' ? v : null;
}

function parseFilters(raw: SearchParams): MemoriesFilters & { tier: TierFilter } {
  return {
    q: firstParam(raw.q),
    source: firstParam(raw.source),
    from: firstParam(raw.from),
    to: firstParam(raw.to),
    tag: firstParam(raw.tag),
    page: toIntOrDefault(raw.page, 1),
    tier: parseTier(raw.tier),
  };
}

async function fetchPage(filters: MemoriesFilters & { tier: TierFilter }): Promise<{
  rows: MemoryRow[];
  total: number;
  sources: string[];
  tags: string[];
  tierCounts: { high: number; standard: number; low: number; legacy: number };
}> {
  const empty = {
    rows: [],
    total: 0,
    sources: [],
    tags: [],
    tierCounts: { high: 0, standard: 0, low: 0, legacy: 0 },
  };
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) return empty;

  const from = Math.max(0, (filters.page - 1) * PAGE_SIZE);
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('memories')
    .select('id, content, source, tags, created_at', { count: 'exact' })
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.source) query = query.eq('source', filters.source);
  if (filters.tier) query = query.eq('signal_tier', filters.tier);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) {
    // Treat as end-of-day when the user passed a plain YYYY-MM-DD.
    const end = /^\d{4}-\d{2}-\d{2}$/.test(filters.to)
      ? `${filters.to}T23:59:59.999Z`
      : filters.to;
    query = query.lte('created_at', end);
  }
  if (filters.tag) query = query.contains('tags', [filters.tag]);
  if (filters.q) {
    // Postgres FTS via the generated content_tsv column. Falls back gracefully
    // if the query is not a well-formed tsquery.
    query = query.textSearch('content_tsv', filters.q, {
      type: 'websearch',
      config: 'english',
    });
  }

  const [{ data, count, error }, facets, tierCounts] = await Promise.all([
    query,
    fetchFacets(supabase, user.id),
    fetchTierCounts(supabase, user.id),
  ]);
  if (error) return { ...empty, ...facets, tierCounts };

  return {
    rows: (data ?? []) as MemoryRow[],
    total: count ?? 0,
    sources: facets.sources,
    tags: facets.tags,
    tierCounts,
  };
}

async function fetchTierCounts(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  userId: string
): Promise<{ high: number; standard: number; low: number; legacy: number }> {
  // Four cheap head-counts. Partial index on (user, signal_tier, ts) makes
  // each one < 5ms. Total ~20ms even on 1M-row archives.
  const tierFor = async (tier: 'high' | 'standard' | 'low' | null): Promise<number> => {
    let q = supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null);
    if (tier === null) q = q.is('signal_tier', null);
    else q = q.eq('signal_tier', tier);
    const { count } = await q;
    return count ?? 0;
  };
  const [high, standard, low, legacy] = await Promise.all([
    tierFor('high'),
    tierFor('standard'),
    tierFor('low'),
    tierFor(null),
  ]);
  return { high, standard, low, legacy };
}

async function fetchFacets(
  supabase: NonNullable<Awaited<ReturnType<typeof getServerSupabase>>>,
  userId: string
): Promise<{ sources: string[]; tags: string[] }> {
  // Lightweight facet sample: look at the 500 most-recent rows to build the
  // source/tag pickers. Good enough for the dashboard — we never claim this
  // is exhaustive, just what the user has been capturing lately.
  const { data } = await supabase
    .from('memories')
    .select('source, tags')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500);
  const sources = new Set<string>();
  const tags = new Set<string>();
  for (const row of data ?? []) {
    const src = (row as { source: string | null }).source;
    if (src) sources.add(src);
    const t = (row as { tags: string[] | null }).tags;
    if (Array.isArray(t)) for (const tag of t) if (tag) tags.add(tag);
  }
  return {
    sources: [...sources].sort(),
    tags: [...tags].sort(),
  };
}

export default async function MemoriesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const { rows, total, sources, tags, tierCounts } = await fetchPage(filters);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build query-string preservers so the tier pills round-trip every other
  // filter the user already set.
  const otherParams = new URLSearchParams();
  if (filters.q) otherParams.set('q', filters.q);
  if (filters.source) otherParams.set('source', filters.source);
  if (filters.from) otherParams.set('from', filters.from);
  if (filters.to) otherParams.set('to', filters.to);
  if (filters.tag) otherParams.set('tag', filters.tag);
  const baseHref = otherParams.toString() ? `?${otherParams.toString()}&` : '?';
  const tierHref = (tier: 'high' | 'standard' | 'low' | null) =>
    tier === null ? (baseHref === '?' ? '/dashboard/memories' : baseHref.slice(0, -1)) : `${baseHref}tier=${tier}`;

  return (
    <main>
      <section className="px-6 md:px-16 pt-24 pb-24">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 001 &middot; Archive
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Every word.
          </h1>
          <p className="text-cream/60 text-lg max-w-xl leading-relaxed mb-16">
            Your full corpus of memories. Append-only. Never summarised. Searchable by meaning — the raw
            sentence stays where you put it.
          </p>

          {/* Brief 023 — signal-tier strip. Click to filter. Legacy pill */}
          {/* shows pre-tiering rows; hidden once everything has a score. */}
          <nav
            aria-label="Signal tier filter"
            className="flex flex-wrap items-baseline gap-x-8 gap-y-3 mb-10 pb-10 border-b border-cream/[0.06]"
          >
            <TierPill
              label="High signal"
              count={tierCounts.high}
              href={tierHref('high')}
              active={filters.tier === 'high'}
              accent="amber"
              hint="injected first into context"
            />
            <TierPill
              label="Standard"
              count={tierCounts.standard}
              href={tierHref('standard')}
              active={filters.tier === 'standard'}
              accent="cream"
              hint="full semantic recall"
            />
            <TierPill
              label="Filtered"
              count={tierCounts.low}
              href={tierHref('low')}
              active={filters.tier === 'low'}
              accent="muted"
              hint="timeline only — out of search"
            />
            {tierCounts.legacy > 0 && (
              <TierPill
                label="Legacy"
                count={tierCounts.legacy}
                href={tierHref(null)}
                active={false}
                accent="muted"
                hint="captured before tiering"
              />
            )}
            {filters.tier !== null && (
              <a
                href={tierHref(null)}
                className="font-mono text-[10px] uppercase tracking-widest text-cream/40 hover:text-amber ml-auto self-center"
              >
                clear filter ×
              </a>
            )}
          </nav>

          <MemoriesClient
            filters={filters}
            rows={rows}
            total={total}
            pageSize={PAGE_SIZE}
            pageCount={pageCount}
            sources={sources}
            tags={tags}
          />
        </div>
      </section>
    </main>
  );
}
