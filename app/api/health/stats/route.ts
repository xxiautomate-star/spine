import { NextResponse } from 'next/server';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export type DayCount = { day: string; count: number };

export type DuplicateCluster = {
  memory_id: string;
  duplicate_id: string;
  similarity: number;
  content_preview: string;
  dup_preview: string;
  created_at: string;
};

export type HealthStats = {
  total: number;
  by_date: DayCount[];
  orphan_count: number;
  edge_count: number;
  days_covered: number;
  coverage_pct: number;
  duplicate_clusters: DuplicateCluster[];
};

export async function GET(): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  const user = await getServerUser();

  if (!supabase || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Core stats via RPC
  const { data: statsData, error: statsError } = await supabase.rpc('spine_health_stats', {
    p_user: user.id,
  });

  if (statsError) {
    return NextResponse.json({ error: statsError.message }, { status: 500 });
  }

  const core = statsData as {
    total: number;
    by_date: DayCount[];
    orphan_count: number;
    edge_count: number;
    days_covered: number;
    coverage_pct: number;
  };

  // Duplicate clusters from memory_duplicates table (top 20 by similarity)
  const { data: dupRows } = await supabase
    .from('memory_duplicates')
    .select('memory_id, duplicate_id, similarity')
    .eq('user_id', user.id)
    .gte('similarity', 0.9)
    .order('similarity', { ascending: false })
    .limit(20);

  let duplicate_clusters: DuplicateCluster[] = [];

  if (dupRows && dupRows.length > 0) {
    const allIds = [
      ...dupRows.map((r) => r.memory_id as string),
      ...dupRows.map((r) => r.duplicate_id as string),
    ];
    const uniqueIds = [...new Set(allIds)];

    const { data: memRows } = await supabase
      .from('memories')
      .select('id, content, created_at')
      .in('id', uniqueIds);

    const memMap = new Map(
      (memRows ?? []).map((m) => [
        m.id as string,
        { content: m.content as string, created_at: m.created_at as string },
      ])
    );

    duplicate_clusters = dupRows.map((r) => ({
      memory_id: r.memory_id as string,
      duplicate_id: r.duplicate_id as string,
      similarity: r.similarity as number,
      content_preview: (memMap.get(r.memory_id as string)?.content ?? '').slice(0, 120),
      dup_preview: (memMap.get(r.duplicate_id as string)?.content ?? '').slice(0, 120),
      created_at: memMap.get(r.memory_id as string)?.created_at ?? '',
    }));
  }

  const result: HealthStats = {
    total: core.total ?? 0,
    by_date: core.by_date ?? [],
    orphan_count: core.orphan_count ?? 0,
    edge_count: core.edge_count ?? 0,
    days_covered: core.days_covered ?? 0,
    coverage_pct: core.coverage_pct ?? 0,
    duplicate_clusters,
  };

  return NextResponse.json(result);
}
