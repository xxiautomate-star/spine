// POST /api/memories/[id]/revive
// Un-archives a soft-archived memory. Resets archived_at and bumps last_accessed_at.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const now = new Date().toISOString();

  const { data, error } = await sb
    .from('memories')
    .update({ archived_at: null, last_accessed_at: now })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .not('archived_at', 'is', null)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Memory not found or not archived.' }, { status: 404 });

  return NextResponse.json({ ok: true, id });
}
