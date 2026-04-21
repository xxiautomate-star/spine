// Entity extractor: runs every captured memory through Haiku-4.5 to pull
// out specific named entities, then writes them into entity_nodes and
// entity_edges. The graph that grows here powers /graph and daily digest.
//
// Entity specificity rule: "Roman Puglielli" not "user", "Next.js 15" not
// "framework", "Supabase pgvector" not "database". Generic words are rejected.

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Haiku call ───────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You are a precise entity extractor for Spine, a persistent AI memory system.

Given a block of text from an AI conversation, extract specific named entities into five categories.

SPECIFICITY IS MANDATORY:
- people:    Real names only. "Roman" not "the user". "Anthropic CEO" if name unknown.
- projects:  Product names, repo names, codebases. "xxiautomate-spine" not "the project".
- tools:     Specific tech. "claude-haiku-4-5", "Supabase pgvector", "Next.js 15".
- concepts:  Domain terms. "entity extraction", "RLS policy", "cosine similarity".
- decisions: Choices actually made. "switched from Vercel to Coolify", "chose pgvector over Pinecone".

Rules:
- Return 0–6 items per category.
- Skip generic words: "project", "user", "system", "app", "data", "code".
- For decisions, capture the exact pivot/choice, not a description.
- Return STRICT JSON, nothing else.

JSON shape:
{
  "people":    ["<name>", ...],
  "projects":  ["<name>", ...],
  "tools":     ["<name>", ...],
  "concepts":  ["<name>", ...],
  "decisions": ["<specific decision>", ...]
}`;

type RawEntities = {
  people?: string[];
  projects?: string[];
  tools?: string[];
  concepts?: string[];
  decisions?: string[];
};

type ExtractedEntities = {
  people: string[];
  projects: string[];
  tools: string[];
  concepts: string[];
  decisions: string[];
};

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function cleanName(name: string): string {
  return name.trim().slice(0, 120);
}

const GENERIC_WORDS = new Set([
  'user', 'project', 'system', 'app', 'data', 'code', 'api', 'service',
  'server', 'client', 'model', 'tool', 'it', 'this', 'that', 'the', 'an',
  'a', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'shall', 'can', 'file', 'function', 'class', 'type', 'value',
  'object', 'array', 'string', 'number', 'boolean', 'null', 'undefined',
  'true', 'false', 'yes', 'no', 'not', 'and', 'or', 'but', 'if', 'then',
  'else', 'for', 'while', 'return', 'new', 'old', 'first', 'last', 'next',
  'prev', 'current', 'existing', 'other', 'another', 'all', 'any', 'some',
  'many', 'much', 'more', 'most', 'less', 'least', 'very', 'just', 'only',
  'also', 'too', 'so', 'already', 'still', 'yet', 'now', 'then', 'here',
  'there', 'where', 'when', 'how', 'why', 'what', 'who', 'which', 'that',
]);

function isGeneric(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.length < 3) return true;
  if (GENERIC_WORDS.has(lower)) return true;
  // Reject single-word all-lowercase under 5 chars with no digits
  if (lower === name && lower.length < 5 && !/\d/.test(lower)) return true;
  return false;
}

async function callHaiku(content: string): Promise<ExtractedEntities> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured.');

  const truncated = content.length > 3000 ? content.slice(0, 3000) + '…' : content;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: truncated }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Haiku entity extraction ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '{}';

  let raw: RawEntities = {};
  try {
    raw = JSON.parse(stripFences(text)) as RawEntities;
  } catch {
    raw = {};
  }

  const clean = (arr: string[] | undefined): string[] =>
    (arr ?? [])
      .map(cleanName)
      .filter((n) => n.length >= 2 && !isGeneric(n))
      .slice(0, 8);

  return {
    people: clean(raw.people),
    projects: clean(raw.projects),
    tools: clean(raw.tools),
    concepts: clean(raw.concepts),
    decisions: clean(raw.decisions),
  };
}

// ── Graph writes ──────────────────────────────────────────────────────────

type EntityType = 'person' | 'project' | 'tool' | 'concept' | 'decision';

type NodeRow = {
  id: string;
  user_id: string;
  name: string;
  type: EntityType;
  mention_count: number;
  first_seen: string;
  last_seen: string;
};

async function upsertNode(
  sb: SupabaseClient,
  userId: string,
  name: string,
  type: EntityType,
  now: string
): Promise<string | null> {
  // Try insert; on conflict (user_id, name, type) increment mention_count.
  const { data: existing } = await sb
    .from('entity_nodes')
    .select('id, mention_count')
    .eq('user_id', userId)
    .eq('name', name)
    .eq('type', type)
    .maybeSingle();

  if (existing) {
    await sb
      .from('entity_nodes')
      .update({ mention_count: (existing.mention_count as number) + 1, last_seen: now })
      .eq('id', existing.id as string);
    return existing.id as string;
  }

  const { data: inserted, error } = await sb
    .from('entity_nodes')
    .insert({ user_id: userId, name, type, mention_count: 1, first_seen: now, last_seen: now })
    .select('id')
    .maybeSingle();

  if (error || !inserted) return null;
  return inserted.id as string;
}

async function upsertEdge(
  sb: SupabaseClient,
  userId: string,
  fromNode: string,
  toNode: string,
  edgeType: 'MENTIONED_IN' | 'RELATED_TO' | 'SUPERSEDES',
  memoryId: string,
  weight = 1.0
): Promise<void> {
  // Canonical ordering: smaller UUID first, so A→B and B→A collapse to one edge.
  const [a, b] = fromNode < toNode ? [fromNode, toNode] : [toNode, fromNode];
  await sb.from('entity_edges').upsert(
    { user_id: userId, from_node: a, to_node: b, edge_type: edgeType, memory_id: memoryId, weight },
    { onConflict: 'from_node,to_node,edge_type,memory_id', ignoreDuplicates: true }
  );
}

// ── Public API ────────────────────────────────────────────────────────────

export type ExtractionResult = {
  entities: ExtractedEntities;
  nodeIds: string[];
  edgesCreated: number;
  latencyMs: number;
};

/**
 * Extract entities from a single memory's content and write them to the
 * entity graph. Safe to call fire-and-forget — errors are swallowed and
 * logged to avoid disrupting the capture pipeline.
 */
export async function extractAndIndex(
  sb: SupabaseClient,
  userId: string,
  memoryId: string,
  content: string
): Promise<ExtractionResult> {
  const started = Date.now();

  const entities = await callHaiku(content);

  const now = new Date().toISOString();

  // Flatten all entities into (name, type) pairs for node upsert.
  const pairs: Array<[string, EntityType]> = [
    ...entities.people.map((n): [string, EntityType] => [n, 'person']),
    ...entities.projects.map((n): [string, EntityType] => [n, 'project']),
    ...entities.tools.map((n): [string, EntityType] => [n, 'tool']),
    ...entities.concepts.map((n): [string, EntityType] => [n, 'concept']),
    ...entities.decisions.map((n): [string, EntityType] => [n, 'decision']),
  ];

  if (pairs.length === 0) {
    return { entities, nodeIds: [], edgesCreated: 0, latencyMs: Date.now() - started };
  }

  // Upsert all nodes sequentially (avoid race on the unique constraint).
  const nodeIds: string[] = [];
  for (const [name, type] of pairs) {
    const id = await upsertNode(sb, userId, name, type, now);
    if (id) nodeIds.push(id);
  }

  let edgesCreated = 0;

  // RELATED_TO: all node pairs that co-occur in this memory.
  // Skip if only one entity — nothing to connect.
  if (nodeIds.length >= 2) {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        await upsertEdge(sb, userId, nodeIds[i], nodeIds[j], 'RELATED_TO', memoryId);
        edgesCreated++;
      }
    }
  }

  // SUPERSEDES: decisions linked to all tools/concepts in the same memory.
  // A decision is a pivot — connect it to whatever it was deciding about.
  const decisionPairs = pairs.filter(([, t]) => t === 'decision');
  const subjectPairs = pairs.filter(([, t]) => t === 'tool' || t === 'concept' || t === 'project');

  if (decisionPairs.length > 0 && subjectPairs.length > 0) {
    const decisionNodeIds = nodeIds.slice(
      entities.people.length + entities.projects.length + entities.tools.length + entities.concepts.length
    );
    const subjectNodeIds = nodeIds.slice(
      entities.people.length,
      entities.people.length + entities.projects.length + entities.tools.length + entities.concepts.length
    );

    for (const dNodeId of decisionNodeIds) {
      for (const sNodeId of subjectNodeIds) {
        await upsertEdge(sb, userId, dNodeId, sNodeId, 'SUPERSEDES', memoryId, 1.5);
        edgesCreated++;
      }
    }
  }

  return {
    entities,
    nodeIds,
    edgesCreated,
    latencyMs: Date.now() - started,
  };
}

/**
 * Batch-extract entities for a list of memories. Used by the daily-digest
 * cron to back-fill any memories that were captured before extraction was wired.
 * Processes one at a time to avoid Haiku rate limits.
 */
export async function batchExtract(
  sb: SupabaseClient,
  userId: string,
  memories: Array<{ id: string; content: string }>,
  opts: { delayMs?: number } = {}
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;
  const delay = opts.delayMs ?? 200;

  for (const mem of memories) {
    try {
      await extractAndIndex(sb, userId, mem.id, mem.content);
      processed++;
    } catch (err) {
      errors++;
      console.error('[spine/entity-extractor] batch error', mem.id, err);
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  return { processed, errors };
}

/**
 * Return the top entities for a user, sorted by mention count.
 * Used by the digest and graph page.
 */
export async function topEntities(
  sb: SupabaseClient,
  userId: string,
  limit = 50
): Promise<NodeRow[]> {
  const { data, error } = await sb
    .from('entity_nodes')
    .select('id, user_id, name, type, mention_count, first_seen, last_seen')
    .eq('user_id', userId)
    .order('mention_count', { ascending: false })
    .order('last_seen', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as NodeRow[];
}

/**
 * Fetch the entity graph — top N nodes + all edges between them.
 * Returned directly from the SQL function spine_entity_graph.
 */
export async function entityGraph(
  sb: SupabaseClient,
  userId: string,
  limit = 50
): Promise<{ nodes: NodeRow[]; edges: unknown[] }> {
  const { data, error } = await sb.rpc('spine_entity_graph', {
    p_user: userId,
    p_limit: limit,
  });

  if (error) throw new Error(error.message);

  const result = (data ?? { nodes: [], edges: [] }) as { nodes: NodeRow[]; edges: unknown[] };
  return result;
}
