// Fire-and-forget retrieval stats bump. Calls the spine_touch_retrieved RPC
// to increment retrieval_count + stamp last_retrieved_at on every memory
// that came back from a recall. Used by /api/recall, /api/recall/inject, and
// /api/recall/raw so the stale-score in the hygiene dashboard stays honest
// regardless of which path the client hit.
//
// Fire-and-forget by design: a slow or failing bump must never stall the
// recall response the user is waiting on.

import { getSupabase } from './supabase';

export function touchRetrieved(userId: string, ids: string[]): void {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) return;
  void supabase
    .rpc('spine_touch_retrieved', { p_user: userId, p_ids: ids })
    .then(() => {}, () => {});
}
