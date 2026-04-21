// Entity disambiguation: Jaro-Winkler similarity, merge proposals, execute merge + undo.

import { SupabaseClient } from '@supabase/supabase-js';

// ── Jaro-Winkler (no dependency) ──────────────────────────────────────────────

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;

  const matchDist = Math.floor(Math.max(la, lb) / 2) - 1;
  const aMatched = new Array(la).fill(false) as boolean[];
  const bMatched = new Array(lb).fill(false) as boolean[];

  let matches = 0, transpositions = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string, p = 0.1): number {
  const j = jaro(a, b);
  const len = Math.min(a.length, b.length, 4);
  let prefix = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * p * (1 - j);
}

export const MERGE_SIMILARITY_THRESHOLD = 0.85;

// ── Proposal generation ───────────────────────────────────────────────────────

interface EntityNode {
  id: string;
  name: string;
  type: string;
}

export async function generateMergeProposals(
  sb: SupabaseClient,
  userId: string
): Promise<number> {
  const { data: nodes } = await sb
    .from('entity_nodes')
    .select('id, name, type')
    .eq('user_id', userId);

  if (!nodes || nodes.length < 2) return 0;

  const typed = nodes as EntityNode[];
  let proposed = 0;

  // Compare all pairs within each type group (avoids Person vs Tool cross-matching)
  const byType = new Map<string, EntityNode[]>();
  for (const n of typed) {
    const arr = byType.get(n.type) ?? [];
    arr.push(n);
    byType.set(n.type, arr);
  }

  for (const [, group] of byType) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const sim = jaroWinkler(a.name.toLowerCase(), b.name.toLowerCase());
        if (sim < MERGE_SIMILARITY_THRESHOLD) continue;

        // Canonical order: smaller UUID first (matches DB unique constraint)
        const [nodeA, nodeB] = a.id < b.id ? [a, b] : [b, a];

        const { error } = await sb.from('entity_merge_proposals').upsert(
          {
            user_id: userId,
            node_id_a: nodeA.id,
            node_id_b: nodeB.id,
            similarity: Math.round(sim * 1000) / 1000,
            status: 'pending',
          },
          { onConflict: 'node_id_a,node_id_b', ignoreDuplicates: true }
        );
        if (!error) proposed++;
      }
    }
  }

  return proposed;
}

// ── Execute merge ─────────────────────────────────────────────────────────────

export async function executeMerge(
  sb: SupabaseClient,
  userId: string,
  proposalId: string,
  survivorId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: proposal } = await sb
    .from('entity_merge_proposals')
    .select('id, node_id_a, node_id_b, status')
    .eq('id', proposalId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!proposal) return { ok: false, error: 'Proposal not found.' };
  if ((proposal.status as string) !== 'pending') return { ok: false, error: 'Proposal is not pending.' };

  const nodeIds = [proposal.node_id_a as string, proposal.node_id_b as string];
  if (!nodeIds.includes(survivorId)) return { ok: false, error: 'survivor_id must be one of the proposal nodes.' };

  const absorbedId = nodeIds.find((n) => n !== survivorId)!;

  // Fetch absorbed node metadata for snapshot
  const { data: absorbed } = await sb
    .from('entity_nodes')
    .select('name, type')
    .eq('id', absorbedId)
    .maybeSingle();

  if (!absorbed) return { ok: false, error: 'Absorbed node not found.' };

  // Re-point all edges from absorbed → survivor
  await sb
    .from('entity_edges')
    .update({ from_node: survivorId })
    .eq('from_node', absorbedId);

  await sb
    .from('entity_edges')
    .update({ to_node: survivorId })
    .eq('to_node', absorbedId);

  // Remove self-loops created by re-pointing
  await sb
    .from('entity_edges')
    .delete()
    .eq('from_node', survivorId)
    .eq('to_node', survivorId);

  // Soft-delete absorbed node
  await sb
    .from('entity_nodes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', absorbedId);

  const undoUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Update proposal status
  await sb
    .from('entity_merge_proposals')
    .update({ status: 'merged', survivor_id: survivorId, can_undo_until: undoUntil })
    .eq('id', proposalId);

  // Write audit log
  await sb.from('entity_merge_log').insert({
    proposal_id: proposalId,
    user_id: userId,
    survivor_id: survivorId,
    absorbed_id: absorbedId,
    snapshot_name: absorbed.name as string,
    snapshot_type: absorbed.type as string,
  });

  return { ok: true };
}

// ── Undo merge ────────────────────────────────────────────────────────────────

export async function undoMerge(
  sb: SupabaseClient,
  userId: string,
  proposalId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data: log } = await sb
    .from('entity_merge_log')
    .select('id, absorbed_id, snapshot_name, snapshot_type, merged_at, undone_at')
    .eq('proposal_id', proposalId)
    .eq('user_id', userId)
    .is('undone_at', null)
    .maybeSingle();

  if (!log) return { ok: false, error: 'Merge log not found or already undone.' };

  const { data: proposal } = await sb
    .from('entity_merge_proposals')
    .select('can_undo_until, survivor_id')
    .eq('id', proposalId)
    .maybeSingle();

  if (!proposal) return { ok: false, error: 'Proposal not found.' };

  const deadline = new Date(proposal.can_undo_until as string);
  if (Date.now() > deadline.getTime()) {
    return { ok: false, error: 'Undo window has expired (7 days).' };
  }

  // Restore absorbed node
  await sb
    .from('entity_nodes')
    .update({ deleted_at: null })
    .eq('id', log.absorbed_id as string);

  // Mark log as undone
  await sb
    .from('entity_merge_log')
    .update({ undone_at: new Date().toISOString() })
    .eq('id', log.id as string);

  // Reset proposal back to pending
  await sb
    .from('entity_merge_proposals')
    .update({ status: 'pending', survivor_id: null, can_undo_until: null })
    .eq('id', proposalId);

  return { ok: true };
}
