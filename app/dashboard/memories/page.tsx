// Server component: renders the archive with filters + pagination. Filters
// drive URL query params so links are shareable and the Back button does the
// right thing. The MemoriesClient handles selection + bulk delete + export
// entirely on top of the server-rendered list.

import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { MemoriesClient, type MemoryRow, type MemoriesFilters } from './MemoriesClient';

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

function parseFilters(raw: SearchParams): MemoriesFilters {
  return {
    q: firstParam(raw.q),
    source: firstParam(raw.source),
    from: firstParam(raw.from),
    to: firstParam(raw.to),
    tag: firstParam(raw.tag),
    page: toIntOrDefault(raw.page, 1),
  };
}

async function fetchPage(filters: MemoriesFilters): Promise<{
  rows: MemoryRow[];
  total: number;
  sources: string[];
  tags: string[];
}> {
  const empty = { rows: [], total: 0, sources: [], tags: [] };
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

  const [{ data, count, error }, facets] = await Promise.all([
    query,
    fetchFacets(supabase, user.id),
  ]);
  if (error) return { ...empty, ...facets };

  return {
    rows: (data ?? []) as MemoryRow[],
    total: count ?? 0,
    sources: facets.sources,
    tags: facets.tags,
  };
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
  const { rows, total, sources, tags } = await fetchPage(filters);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
