// POST /api/team/[id]/join
// Body: { token: string }
// Accepts a pending invite — sets user_id + joined_at on the team_members row.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let token: string;
  try {
    const body = (await req.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || !body.token) {
      return NextResponse.json({ error: 'token required.' }, { status: 400 });
    }
    token = body.token;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Find the invite row.
  const { data: invite } = await sb
    .from('team_members')
    .select('id, team_id, joined_at, invited_email')
    .eq('invite_token', token)
    .eq('team_id', id)
    .maybeSingle();

  if (!invite) return NextResponse.json({ error: 'Invalid or expired invite token.' }, { status: 404 });
  if (invite.joined_at) return NextResponse.json({ error: 'Invite already used.' }, { status: 409 });

  // Accept invite.
  await sb
    .from('team_members')
    .update({
      user_id: user.id,
      joined_at: new Date().toISOString(),
      invite_token: null,
    })
    .eq('id', invite.id as string);

  return NextResponse.json({ ok: true, team_id: invite.team_id });
}
