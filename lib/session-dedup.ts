// Per-session injection de-duplication.
//
// Goal: once a memory is injected into a thread, don't re-inject it on the
// next turn *unless* its relevance score has materially jumped. "Materially"
// here means the new fused score is > previous + SCORE_JUMP_EPSILON.
//
// Sessions are client-assigned — the caller picks the identifier (Claude Code
// conversation UUID, extension session nonce, MCP client thread ID, etc.).

import { getSupabase } from './supabase';

const SCORE_JUMP_EPSILON = 0.15;
const LOOKBACK_HOURS = 6; // older injections are "stale" and may repeat

export type PriorInjection = {
  memoryId: string;
  fusedScore: number;
  injectedAt: string;
};

export async function fetchPriorInjections(
  userId: string,
  sessionId: string
): Promise<Map<string, PriorInjection>> {
  const supabase = getSupabase();
  if (!supabase) return new Map();

  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from('session_injections')
    .select('memory_id, fused_score, injected_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .gte('injected_at', since);

  const map = new Map<string, PriorInjection>();
  for (const row of (data ?? []) as Array<{
    memory_id: string;
    fused_score: number;
    injected_at: string;
  }>) {
    const prior = map.get(row.memory_id);
    if (!prior || row.fused_score > prior.fusedScore) {
      map.set(row.memory_id, {
        memoryId: row.memory_id,
        fusedScore: row.fused_score,
        injectedAt: row.injected_at,
      });
    }
  }
  return map;
}

/**
 * Filters out candidates that were already injected in this session unless
 * the current fused score jumped meaningfully above the prior one.
 */
export function applyDedup<T extends { id: string; fusedScore: number }>(
  candidates: T[],
  priors: Map<string, PriorInjection>
): T[] {
  if (priors.size === 0) return candidates;
  return candidates.filter((c) => {
    const prior = priors.get(c.id);
    if (!prior) return true;
    return c.fusedScore >= prior.fusedScore + SCORE_JUMP_EPSILON;
  });
}

/**
 * Fire-and-forget log of what was actually sent back to the caller, so the
 * next recall in the same session can dedupe.
 */
export function logInjections(args: {
  userId: string;
  sessionId: string;
  memories: Array<{ id: string; fusedScore?: number }>;
}): void {
  if (args.memories.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;

  const rows = args.memories.map((m) => ({
    user_id: args.userId,
    session_id: args.sessionId,
    memory_id: m.id,
    fused_score: m.fusedScore ?? 0,
  }));

  void supabase
    .from('session_injections')
    .insert(rows)
    .then(() => {}, () => {});
}
