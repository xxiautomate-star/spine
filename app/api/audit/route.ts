// GET /api/audit — unified memory operation log.
//
// Returns recent rows from public.memory_audit for the calling key's user,
// scoped by op + time window. The dashboard reads this for the activity strip;
// the MCP package can read it for "what did this agent see?" introspection.
//
// Query params (all optional):
//   op       — comma-separated subset of: read,write,embed,reembed,delete
//   since    — ISO-8601 lower bound (default: 30 days ago)
//   until    — ISO-8601 upper bound (default: now)
//   limit    — 1..500 (default 100)
//   memory_id — restrict to one memory's history
//   include_stats — '1' to include per-op aggregates from spine_audit_stats
//
// Response:
//   { rows: AuditRow[], stats?: AuditStat[] }

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_OPS = new Set(['read', 'write', 'embed', 'reembed', 'delete']);

export async function OPTIONS() {
  return preflight();
}

function parseIso(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  const url = req.nextUrl;
  const opsParam = url.searchParams.get('op');
  const ops = opsParam
    ? opsParam.split(',').map((s) => s.trim()).filter((s) => VALID_OPS.has(s))
    : null;

  const since =
    parseIso(url.searchParams.get('since')) ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const until = parseIso(url.searchParams.get('until')) ?? new Date().toISOString();

  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') ?? '100')));
  const memoryId = url.searchParams.get('memory_id');
  const includeStats = url.searchParams.get('include_stats') === '1';

  const supabase = getSupabase();
  if (!supabase)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  let query = supabase
    .from('memory_audit')
    .select('id, op, memory_id, query, caller, mime, embed_provider, metadata, created_at')
    .eq('user_id', auth.authed.userId)
    .gte('created_at', since)
    .lte('created_at', until)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (ops && ops.length > 0) query = query.in('op', ops);
  if (memoryId) query = query.eq('memory_id', memoryId);

  const { data, error } = await query;
  if (error) return withCors(NextResponse.json({ error: error.message }, { status: 500 }));

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    op: r.op,
    memoryId: r.memory_id,
    query: r.query,
    caller: r.caller,
    mime: r.mime,
    embedProvider: r.embed_provider,
    metadata: r.metadata,
    createdAt: r.created_at,
  }));

  let stats: Array<{ op: string; total: number; lastAt: string | null; uniqueCallers: number }> | undefined;
  if (includeStats) {
    const { data: statsData, error: statsErr } = await supabase.rpc('spine_audit_stats', {
      p_user: auth.authed.userId,
      p_since: since,
    });
    if (!statsErr && Array.isArray(statsData)) {
      stats = (statsData as Array<{ op: string; total: number | string; last_at: string | null; unique_callers: number | string }>).map((s) => ({
        op: s.op,
        total: Number(s.total ?? 0),
        lastAt: s.last_at ?? null,
        uniqueCallers: Number(s.unique_callers ?? 0),
      }));
    }
  }

  return withCors(NextResponse.json({ rows, ...(stats ? { stats } : {}) }));
}
