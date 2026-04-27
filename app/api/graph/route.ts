// GET /api/graph — entity graph for the authenticated user, with decisions
// woven in as first-class nodes.
//
// Auth: session cookie (dashboard page).
//
// Returns { nodes: GraphNode[], edges: GraphEdge[] } where:
//   - "entity" nodes come from public.entity_nodes (people, projects, tools,
//     concepts) — type='decision' rows in entity_nodes are dropped here, the
//     decisions table is canonical
//   - "decision" nodes come from public.decisions (status='active' only, so
//     superseded chains don't pollute the constellation — they live on
//     /dashboard/decisions where the chain itself is the artefact)
//   - decision-to-entity edges synthesised from decision_evidence joined to
//     entity_edges via memory_id — each decision links to every entity its
//     source memory mentioned

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { entityGraph } from '@/lib/entity-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GraphNode = {
  id: string;
  name: string;
  type: 'person' | 'project' | 'tool' | 'concept' | 'decision';
  mention_count: number;
  last_seen: string;
  // Decision-only fields. Entity nodes leave these undefined.
  statement?: string;
  confidence?: number;
  status?: 'active' | 'superseded' | 'reverted' | 'pending_review';
  source_memory_id?: string | null;
};

type GraphEdge = {
  id: string;
  from_node: string;
  to_node: string;
  edge_type: 'MENTIONED_IN' | 'RELATED_TO' | 'SUPERSEDES' | 'DECIDES_ABOUT';
  weight: number;
};

const DECISION_LIMIT = 30; // top-K active decisions; keeps the canvas readable

export async function GET(_req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  try {
    // ── Existing entity graph ──────────────────────────────────────────────
    const entityResult = await entityGraph(sb, user.id, 60);
    const entityNodes = entityResult.nodes as Array<GraphNode>;
    const entityEdges = entityResult.edges as Array<GraphEdge>;

    // Drop legacy decision-typed rows from entity_nodes — the decisions
    // table is now canonical for that type.
    const filteredEntityNodes = entityNodes.filter((n) => n.type !== 'decision');
    const keepNodeIds = new Set(filteredEntityNodes.map((n) => n.id));
    const filteredEntityEdges = entityEdges.filter(
      (e) => keepNodeIds.has(e.from_node) && keepNodeIds.has(e.to_node)
    );

    // ── Decisions ───────────────────────────────────────────────────────────
    // We only render active decisions in the constellation. Superseded
    // ones are on /dashboard/decisions where the chain context matters.
    const { data: decisionRows, error: dErr } = await sb
      .from('decisions')
      .select('id, statement, confidence, status, source_memory_id, created_at, tags')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(DECISION_LIMIT);

    if (dErr) {
      // If decisions read fails (e.g. migration 017 not yet applied), don't
      // break the graph — fall back to entity-only rendering.
      return NextResponse.json({
        nodes: filteredEntityNodes,
        edges: filteredEntityEdges,
      });
    }

    type DecisionRow = {
      id: string;
      statement: string;
      confidence: number;
      status: 'active' | 'superseded' | 'reverted' | 'pending_review';
      source_memory_id: string | null;
      created_at: string;
      tags: string[] | null;
    };

    const decisions = (decisionRows ?? []) as DecisionRow[];

    // ── Decision-to-entity edges ────────────────────────────────────────────
    // For each decision with a source memory, find every entity_edge that
    // touches that memory and synthesise a DECIDES_ABOUT edge. Entities
    // appearing in the decision's source conversation are the things the
    // decision is *about*. Cheap union — no per-decision query needed.
    const sourceMemoryIds = decisions
      .map((d) => d.source_memory_id)
      .filter((id): id is string => typeof id === 'string');

    const decisionEdges: GraphEdge[] = [];
    if (sourceMemoryIds.length > 0) {
      const { data: edgeRows } = await sb
        .from('entity_edges')
        .select('memory_id, from_node, to_node')
        .eq('user_id', user.id)
        .in('memory_id', sourceMemoryIds);

      // memory_id → set of entity-node ids that appear in that conversation
      const memoryToEntities = new Map<string, Set<string>>();
      for (const e of (edgeRows ?? []) as Array<{ memory_id: string; from_node: string; to_node: string }>) {
        const set = memoryToEntities.get(e.memory_id) ?? new Set<string>();
        if (keepNodeIds.has(e.from_node)) set.add(e.from_node);
        if (keepNodeIds.has(e.to_node))   set.add(e.to_node);
        memoryToEntities.set(e.memory_id, set);
      }

      for (const d of decisions) {
        if (!d.source_memory_id) continue;
        const entities = memoryToEntities.get(d.source_memory_id);
        if (!entities) continue;
        for (const entityId of entities) {
          decisionEdges.push({
            id: `dec-${d.id}-${entityId}`,
            from_node: d.id,
            to_node: entityId,
            edge_type: 'DECIDES_ABOUT',
            weight: 1.0,
          });
        }
      }
    }

    // ── Decision nodes ──────────────────────────────────────────────────────
    // The constellation renders by `name`; for decisions we show a short
    // label (≤32 chars) and keep the full statement in the metadata for the
    // tooltip / sidebar.
    const decisionNodes: GraphNode[] = decisions.map((d) => ({
      id: d.id,
      name: d.statement.length > 32 ? d.statement.slice(0, 30) + '…' : d.statement,
      type: 'decision' as const,
      // Use connection count as a proxy for "weight" so popular decisions
      // (touching many entities) get bigger nodes — same heuristic the
      // entity nodes use for mention_count.
      mention_count: Math.max(
        1,
        decisionEdges.filter((e) => e.from_node === d.id).length
      ),
      last_seen: d.created_at,
      statement: d.statement,
      confidence: d.confidence,
      status: d.status,
      source_memory_id: d.source_memory_id,
    }));

    return NextResponse.json({
      nodes: [...filteredEntityNodes, ...decisionNodes],
      edges: [...filteredEntityEdges, ...decisionEdges],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Graph fetch failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
