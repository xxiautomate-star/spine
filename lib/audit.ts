// Unified memory audit trail.
//
// Append-only ledger of every read/write/embed/delete on memories. Sits next
// to the specialised logs (recall_queries, session_injections, org_audit_log)
// — those answer specific product questions; this answers the cross-cut
// "what touched memory X?" / "what did this API key do?".
//
// All writes are best-effort and fire-and-forget. Audit logging never blocks
// or fails the underlying operation. Service role only.

import { getSupabase } from './supabase';

export type AuditOp = 'read' | 'write' | 'embed' | 'reembed' | 'delete';

export type AuditEntry = {
  userId: string | null;
  orgId?: string | null;
  op: AuditOp;
  memoryId?: string | null;
  query?: string | null;
  caller?: string | null;
  mime?: string | null;
  embedProvider?: string | null;
  metadata?: Record<string, unknown>;
};

const QUERY_TRUNCATE_LEN = 500;

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from('memory_audit').insert({
      user_id:        entry.userId,
      org_id:         entry.orgId ?? null,
      op:             entry.op,
      memory_id:      entry.memoryId ?? null,
      query:          truncate(entry.query, QUERY_TRUNCATE_LEN),
      caller:         entry.caller ?? null,
      mime:           entry.mime ?? null,
      embed_provider: entry.embedProvider ?? null,
      metadata:       entry.metadata ?? {},
    });
  } catch {
    // Audit must never break the underlying op.
  }
}

// Batched insert for bulk ops (capture of N memories, recall of N hits).
export async function logAuditBatch(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    const rows = entries.map((e) => ({
      user_id:        e.userId,
      org_id:         e.orgId ?? null,
      op:             e.op,
      memory_id:      e.memoryId ?? null,
      query:          truncate(e.query, QUERY_TRUNCATE_LEN),
      caller:         e.caller ?? null,
      mime:           e.mime ?? null,
      embed_provider: e.embedProvider ?? null,
      metadata:       e.metadata ?? {},
    }));
    await supabase.from('memory_audit').insert(rows);
  } catch {
    /* swallow */
  }
}

// Fire-and-forget wrappers for the common case where the caller doesn't want
// to await. These return immediately and log errors silently.
export function logAuditFireForget(entry: AuditEntry): void {
  void logAudit(entry);
}

export function logAuditBatchFireForget(entries: AuditEntry[]): void {
  void logAuditBatch(entries);
}
