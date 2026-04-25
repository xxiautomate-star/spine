// Per-user clustering for auto-tagging captured memories. Strategy:
//   1. On capture, ask Postgres for the nearest existing cluster via
//      `spine_nearest_cluster`.
//   2. If cosine similarity > JOIN_THRESHOLD, we join that cluster: bump its
//      size, stamp updated_at. The centroid itself stays pinned to the first
//      member — cheaper than rewriting a 1536-dim vector on every insert, and
//      cluster quality holds up because the seed embedding is already a
//      good prototype for that topic.
//   3. Otherwise we spawn a new cluster seeded on this embedding and label it
//      with the first few meaningful words of the content.
//
// The returned value includes the cluster label so /api/capture can merge it
// into the memory's tags.

import type { SupabaseClient } from '@supabase/supabase-js';

export const CLUSTER_JOIN_THRESHOLD = 0.78;

export type ClusterAssignment = {
  clusterId: string;
  label: string;
  joined: boolean;
  similarity: number;
};

type NearestRow = { id: string; label: string; similarity: number };

export async function assignCluster(
  admin: SupabaseClient,
  userId: string,
  embedding: number[],
  content: string
): Promise<ClusterAssignment | null> {
  try {
    const { data, error } = await admin.rpc('spine_nearest_cluster', {
      p_user: userId,
      p_embedding: embedding,
    });
    if (error) return null;

    const nearest = ((data ?? []) as NearestRow[])[0] ?? null;
    if (nearest && nearest.similarity >= CLUSTER_JOIN_THRESHOLD) {
      await admin
        .rpc('spine_increment_cluster_size', { p_cluster: nearest.id })
        .then(() => {}, () => {});
      return {
        clusterId: nearest.id,
        label: nearest.label,
        joined: true,
        similarity: nearest.similarity,
      };
    }

    const label = makeClusterLabel(content);
    const { data: inserted, error: insertErr } = await admin
      .from('memory_clusters')
      .insert({
        user_id: userId,
        label,
        centroid: embedding,
        size: 1,
      })
      .select('id, label')
      .single();
    if (insertErr || !inserted) return null;
    return {
      clusterId: inserted.id as string,
      label: inserted.label as string,
      joined: false,
      similarity: 0,
    };
  } catch {
    return null;
  }
}

/**
 * Strip punctuation, take the first ~4 meaningful words, lowercase-slugify.
 * Labels are display-quality ("launch-checklist", "supabase-rls") not perfect
 * — we show them as tags and in the hygiene dashboard.
 */
export function makeClusterLabel(content: string): string {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
    'is', 'are', 'was', 'were', 'that', 'this', 'it', 'be', 'by', 'at',
    'as', 'from', 'but', 'i', 'we', 'he', 'she', 'they', 'you', 'my',
  ]);
  const words = content
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stop.has(w))
    .slice(0, 4);
  if (words.length === 0) return 'untagged';
  return words.join('-').slice(0, 48);
}
