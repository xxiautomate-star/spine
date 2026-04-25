// POST /api/replay
// Given a file path, returns all memories related to that file in chronological
// order — forming a narrative decision trail. Uses both semantic search
// (embeds the path as a query) and keyword search (ILIKE on content).
// Session-authenticated for the dashboard; also accepts API key for MCP.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { requireApiKey } from '@/lib/auth';
import { embedText } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

interface MemoryHit {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  type: string | null;
  project: string | null;
  created_at: string;
  similarity?: number;
  match_type: 'semantic' | 'keyword' | 'both';
}

async function replayForUser(userId: string, path: string, limit: number): Promise<MemoryHit[]> {
  const sb = getSupabase();
  if (!sb) throw new Error('Server not configured.');

  // Extract the filename and dirname for a broader keyword hit
  const parts = path.replace(/\\/g, '/').split('/');
  const filename = parts.at(-1) ?? path;
  const dirname = parts.at(-2) ?? '';

  // ── Keyword search: memories that literally mention the path ──────────────
  const kwLimit = Math.min(limit * 2, 100);
  const { data: kwData } = await sb
    .from('memories')
    .select('id, content, source, tags, type, project, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .or(`content.ilike.%${filename}%${dirname ? `,content.ilike.%${dirname}%` : ''}`)
    .order('created_at', { ascending: true })
    .limit(kwLimit);

  const kwHits = new Map<string, MemoryHit>();
  for (const r of kwData ?? []) {
    kwHits.set(r.id as string, {
      id: r.id as string,
      content: r.content as string,
      source: r.source as string | null,
      tags: r.tags as string[] | null,
      type: r.type as string | null,
      project: r.project as string | null,
      created_at: r.created_at as string,
      match_type: 'keyword',
    });
  }

  // ── Semantic search: embed the path as a query ────────────────────────────
  let semHits: MemoryHit[] = [];
  try {
    const query = `decisions, bugs, and context for file: ${path} (${filename})`;
    const vec = await embedText(query);
    const { data: semData } = await sb.rpc('spine_match_memories', {
      p_user: userId,
      p_query_embedding: vec,
      p_limit: Math.min(limit, 20),
    });

    for (const r of semData ?? []) {
      const row = r as { id: string; content: string; source: string | null; tags: string[] | null; type?: string; project?: string; created_at: string; similarity: number };
      if (!kwHits.has(row.id)) {
        semHits.push({
          id: row.id,
          content: row.content,
          source: row.source,
          tags: row.tags,
          type: row.type ?? null,
          project: row.project ?? null,
          created_at: row.created_at,
          similarity: row.similarity,
          match_type: 'semantic',
        });
      } else {
        const existing = kwHits.get(row.id)!;
        existing.match_type = 'both';
        existing.similarity = row.similarity;
      }
    }
  } catch {
    // Embeddings unavailable — return keyword results only
  }

  // Merge: keyword hits always included; semantic hits above similarity threshold
  const SEM_THRESHOLD = 0.55;
  semHits = semHits.filter((h) => (h.similarity ?? 0) >= SEM_THRESHOLD);

  const merged = [...kwHits.values(), ...semHits];

  // Sort chronologically (oldest first — forms a narrative)
  merged.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return merged.slice(0, limit);
}

export async function POST(req: NextRequest) {
  // Try session auth first (dashboard); fall back to API key (MCP)
  const user = await getServerUser();

  let userId: string;
  if (user) {
    userId = user.id;
  } else {
    const apiAuth = await requireApiKey(req);
    if (!apiAuth.authed) {
      return withCors(NextResponse.json({ error: apiAuth.error }, { status: apiAuth.status }));
    }
    userId = apiAuth.authed.userId;
  }

  let body: { path?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }));
  }

  if (typeof body.path !== 'string' || !body.path.trim()) {
    return withCors(NextResponse.json({ error: 'path is required.' }, { status: 400 }));
  }

  const path = body.path.trim();
  const limit = typeof body.limit === 'number' ? Math.min(100, Math.max(1, body.limit)) : 50;

  try {
    const memories = await replayForUser(userId, path, limit);
    return withCors(NextResponse.json({
      path,
      memories,
      count: memories.length,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Replay failed.';
    return withCors(NextResponse.json({ error: msg }, { status: 500 }));
  }
}
