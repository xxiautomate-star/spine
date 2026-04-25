// GET /api/conflicts
// Returns unresolved (and optionally resolved) memory conflicts for the session user.
// Query params:
//   resolved=true  — include resolved conflicts (default: false, unresolved only)
//   limit=N        — max rows (default 20, max 100)

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const includeResolved = searchParams.get('resolved') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);

  let query = sb
    .from('memory_conflicts')
    .select(
      `id, entity_name, quote_a, quote_b, resolution, resolved_at, created_at,
       mem_a:memories!memory_id_a(id, content, created_at, source),
       mem_b:memories!memory_id_b(id, content, created_at, source)`
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!includeResolved) {
    query = query.is('resolution', null);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ conflicts: data ?? [] });
}
