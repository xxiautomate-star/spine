// Memory decay: archive memories not accessed in 60 days.
// Also provides revive helpers and stale-count queries.

import { SupabaseClient } from '@supabase/supabase-js';

export const DECAY_DAYS = 60;

export interface DecayReport {
  userId: string;
  archived: number;
  dryRun: boolean;
}

export interface UserDecaySummary {
  total: number;
  archived: number;
  active: number;
  staleCount: number; // would be archived on next run
}

export async function archiveStaleForUser(
  sb: SupabaseClient,
  userId: string,
  dryRun = false
): Promise<number> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DECAY_DAYS);

  const { data, error } = await sb.rpc('spine_archive_stale', {
    p_user: userId,
    p_threshold: threshold.toISOString(),
    p_dry_run: dryRun,
  });

  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export async function getUserDecaySummary(
  sb: SupabaseClient,
  userId: string
): Promise<UserDecaySummary> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - DECAY_DAYS);

  const [totalRes, archivedRes, staleRes] = await Promise.all([
    sb
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null),
    sb
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .not('archived_at', 'is', null),
    // Stale = active AND last_accessed_at (or created_at) older than threshold
    sb.rpc('spine_archive_stale', {
      p_user: userId,
      p_threshold: threshold.toISOString(),
      p_dry_run: true,
    }),
  ]);

  const total = totalRes.count ?? 0;
  const archived = archivedRes.count ?? 0;
  const staleCount = (staleRes.data as number) ?? 0;

  return {
    total,
    archived,
    active: total - archived,
    staleCount,
  };
}

export async function runDecayForAllUsers(
  sb: SupabaseClient,
  dryRun = false
): Promise<DecayReport[]> {
  // Get distinct user IDs with at least one memory
  const { data: rows } = await sb
    .from('memories')
    .select('user_id')
    .is('deleted_at', null)
    .is('archived_at', null);

  if (!rows || rows.length === 0) return [];

  // Deduplicate
  const userIds = [...new Set((rows as { user_id: string }[]).map((r) => r.user_id))];

  const reports: DecayReport[] = [];
  for (const userId of userIds) {
    try {
      const archived = await archiveStaleForUser(sb, userId, dryRun);
      if (archived > 0) {
        reports.push({ userId, archived, dryRun });
      }
    } catch {
      // Skip failing users, log in calling context
    }
  }

  return reports;
}
