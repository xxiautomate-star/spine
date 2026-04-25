// GET /api/entity/proposals — pending merge proposals for the session user.
// POST /api/entity/proposals — trigger a fresh scan for this user's entity nodes.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { generateMergeProposals } from '@/lib/entity-merger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data, error } = await sb
    .from('entity_merge_proposals')
    .select(
      `id, similarity, status, can_undo_until, created_at,
       node_a:entity_nodes!node_id_a(id, name, type),
       node_b:entity_nodes!node_id_b(id, name, type)`
    )
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .order('similarity', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ proposals: data ?? [] });
}

export async function POST(_req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const proposed = await generateMergeProposals(sb, user.id);
  return NextResponse.json({ ok: true, proposed });
}
