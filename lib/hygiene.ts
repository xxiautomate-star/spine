// Shared hygiene queries used by /api/hygiene/* routes and the dashboard.
// All functions take an already-authorized admin client + user id; they do
// not handle auth themselves.

import type { SupabaseClient } from '@supabase/supabase-js';

const STALE_MIN_AGE_DAYS = 30;

export type StaleMemory = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  retrieval_count: number;
  last_retrieved_at: string | null;
  days_old: number;
};

export type DuplicatePair = {
  id: string;
  similarity: number;
  detected_at: string;
  a: { id: string; content: string; source: string | null; created_at: string };
  b: { id: string; content: string; source: string | null; created_at: string };
};

export type ClusterSummary = {
  id: string;
  label: string;
  size: number;
  updated_at: string;
};

/**
 * Top-N memories that look like cleanup candidates: at least 30 days old,
 * never retrieved. Ordered oldest first — the stalest of the stale.
 */
export async function listStaleMemories(
  admin: SupabaseClient,
  userId: string,
  limit = 50
): Promise<StaleMemory[]> {
  const cutoff = new Date(Date.now() - STALE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('memories')
    .select('id, content, source, tags, created_at, retrieval_count, last_retrieved_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('last_retrieved_at', null)
    .eq('retrieval_count', 0)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  type Row = {
    id: string;
    content: string;
    source: string | null;
    tags: string[] | null;
    created_at: string;
    retrieval_count: number;
    last_retrieved_at: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    ...r,
    days_old: Math.floor(
      (Date.now() - new Date(r.created_at).getTime()) / (24 * 60 * 60 * 1000)
    ),
  }));
}

export async function listUnresolvedDuplicates(
  admin: SupabaseClient,
  userId: string,
  limit = 100
): Promise<DuplicatePair[]> {
  const { data: pairs, error } = await admin
    .from('memory_duplicates')
    .select('id, similarity, detected_at, memory_id_a, memory_id_b')
    .eq('user_id', userId)
    .is('resolved_at', null)
    .order('similarity', { ascending: false })
    .limit(limit);
  if (error || !pairs || pairs.length === 0) return [];

  const memoryIds = new Set<string>();
  type PairRow = {
    id: string;
    similarity: number;
    detected_at: string;
    memory_id_a: string;
    memory_id_b: string;
  };
  for (const p of pairs as PairRow[]) {
    memoryIds.add(p.memory_id_a);
    memoryIds.add(p.memory_id_b);
  }

  const { data: memories } = await admin
    .from('memories')
    .select('id, content, source, created_at')
    .in('id', [...memoryIds])
    .eq('user_id', userId)
    .is('deleted_at', null);
  type MemRow = { id: string; content: string; source: string | null; created_at: string };
  const byId = new Map<string, MemRow>();
  for (const m of (memories ?? []) as MemRow[]) byId.set(m.id, m);

  return (pairs as PairRow[])
    .map((p) => {
      const a = byId.get(p.memory_id_a);
      const b = byId.get(p.memory_id_b);
      if (!a || !b) return null;
      return { id: p.id, similarity: p.similarity, detected_at: p.detected_at, a, b };
    })
    .filter((x): x is DuplicatePair => x !== null);
}

/**
 * Find near-duplicate candidates for a single newly-captured memory and
 * upsert pairs into memory_duplicates. Canonicalizes each pair so the
 * smaller UUID lands in memory_id_a — the unique constraint on
 * (memory_id_a, memory_id_b) treats (a,b) and (b,a) as distinct, so we
 * need a stable ordering to deduplicate across scans.
 *
 * Safe to call fire-and-forget from /api/capture: failures are swallowed
 * because a scan miss is less important than a successful capture.
 */
export async function scanDuplicatesForMemory(
  admin: SupabaseClient,
  userId: string,
  memoryId: string
): Promise<number> {
  try {
    const { data, error } = await admin.rpc('spine_duplicates_for_memory', {
      p_user: userId,
      p_memory_id: memoryId,
      p_threshold: 0.92,
      p_limit: 20,
    });
    if (error || !data) return 0;
    type Hit = { other_id: string; similarity: number };
    const hits = data as Hit[];
    if (hits.length === 0) return 0;

    const rows = hits.map((h) => {
      const [a, b] = memoryId < h.other_id ? [memoryId, h.other_id] : [h.other_id, memoryId];
      return {
        user_id: userId,
        memory_id_a: a,
        memory_id_b: b,
        similarity: h.similarity,
      };
    });

    const { error: upErr, count } = await admin
      .from('memory_duplicates')
      .upsert(rows, {
        onConflict: 'memory_id_a,memory_id_b',
        ignoreDuplicates: true,
        count: 'exact',
      });
    if (upErr) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listClusters(
  admin: SupabaseClient,
  userId: string,
  limit = 20
): Promise<ClusterSummary[]> {
  const { data, error } = await admin
    .from('memory_clusters')
    .select('id, label, size, updated_at')
    .eq('user_id', userId)
    .order('size', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as ClusterSummary[];
}
