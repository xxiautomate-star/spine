// GET /api/decisions — list a user's extracted decisions.
//
// The dashboard page reads this for the timeline view. The MCP package can
// also call it for `spine_decisions(query)` introspection — "what have we
// decided about X?"
//
// Query params (all optional):
//   q        — full-text search over the statement
//   status   — comma-separated subset of: active,superseded,reverted,pending_review
//              default: active (most users want the current authoritative set)
//   tag      — restrict to decisions tagged with this tag
//   since    — ISO-8601 lower bound on created_at
//   limit    — 1..200 (default 50)
//   include_stats — '1' to include per-status counts via spine_decision_stats
//
// Auth: session cookie (dashboard) OR bearer API key (MCP). Both are checked;
// session wins because dashboard hits are the dominant path.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { requireApiKey } from '@/lib/auth';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = new Set(['active', 'superseded', 'reverted', 'pending_review']);

export async function OPTIONS() {
  return preflight();
}

function parseIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function resolveUserId(req: NextRequest): Promise<{ userId: string } | { error: string; status: number }> {
  // Try session first (dashboard path).
  if (isAuthConfigured()) {
    const user = await getServerUser();
    if (user) return { userId: user.id };
  }
  // Fall back to bearer key (MCP path).
  const auth = await requireApiKey(req);
  if (auth.authed) return { userId: auth.authed.userId };
  return { error: auth.error, status: auth.status };
}

export async function GET(req: NextRequest) {
  const resolved = await resolveUserId(req);
  if ('error' in resolved) {
    return withCors(NextResponse.json({ error: resolved.error }, { status: resolved.status }));
  }

  const url = req.nextUrl;
  const q = url.searchParams.get('q')?.trim() ?? '';
  const statusesParam = url.searchParams.get('status');
  const statuses = statusesParam
    ? statusesParam.split(',').map((s) => s.trim()).filter((s) => VALID_STATUSES.has(s))
    : ['active']; // default: only the current authoritative set
  const tag = url.searchParams.get('tag')?.trim() ?? '';
  const since = parseIso(url.searchParams.get('since'));
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '50')));
  const includeStats = url.searchParams.get('include_stats') === '1';

  const supabase = getSupabase();
  if (!supabase) {
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));
  }

  // Two paths: full-text search (q present) goes through the RPC for ts_rank
  // ordering; plain list uses a direct select for simpler filter composition.
  let rows;
  if (q) {
    const { data, error } = await supabase.rpc('spine_search_decisions', {
      p_user: resolved.userId,
      p_query: q,
      p_limit: limit,
    });
    if (error) return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    rows = (data ?? []) as Array<{
      id: string;
      statement: string;
      context: string | null;
      status: string;
      confidence: number;
      tags: string[] | null;
      source_memory_id: string | null;
      superseded_by: string | null;
      rank: number;
      created_at: string;
    }>;
    // Apply status + tag + since filters client-side over the small set.
    rows = rows.filter((r) => {
      if (!statuses.includes(r.status)) return false;
      if (tag && !(r.tags ?? []).includes(tag)) return false;
      if (since && r.created_at < since) return false;
      return true;
    });
  } else {
    let query = supabase
      .from('decisions')
      .select('id, statement, context, status, confidence, tags, source_memory_id, superseded_by, created_at')
      .eq('user_id', resolved.userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (statuses.length > 0) query = query.in('status', statuses);
    if (tag) query = query.contains('tags', [tag]);
    if (since) query = query.gte('created_at', since);

    const { data, error } = await query;
    if (error) return withCors(NextResponse.json({ error: error.message }, { status: 500 }));
    rows = data ?? [];
  }

  let stats: Array<{ status: string; total: number; lastAt: string | null }> | undefined;
  if (includeStats) {
    const { data: statsData, error: statsErr } = await supabase.rpc('spine_decision_stats', {
      p_user: resolved.userId,
    });
    if (!statsErr && Array.isArray(statsData)) {
      stats = (statsData as Array<{ status: string; total: number | string; last_at: string | null }>).map((s) => ({
        status: s.status,
        total: Number(s.total ?? 0),
        lastAt: s.last_at ?? null,
      }));
    }
  }

  return withCors(
    NextResponse.json({
      decisions: rows,
      ...(stats ? { stats } : {}),
    })
  );
}
