// POST /api/team — create a team (Power plan only)
// GET  /api/team — list teams the user belongs to

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Get teams the user is a joined member of.
  const { data: memberships } = await sb
    .from('team_members')
    .select('team_id, role, joined_at')
    .eq('user_id', user.id)
    .not('joined_at', 'is', null);

  if (!memberships || memberships.length === 0) return NextResponse.json({ teams: [] });

  const teamIds = (memberships as { team_id: string }[]).map((m) => m.team_id);
  const { data: teams } = await sb
    .from('teams')
    .select('id, name, creator_id, created_at')
    .in('id', teamIds);

  return NextResponse.json({ teams: teams ?? [] });
}

export async function POST(req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Check plan — teams require Power tier.
  const { data: profile } = await sb
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || (profile.plan as string) !== 'team') {
    return NextResponse.json(
      {
        error: 'Team creation requires the Power plan.',
        error_code: 'plan_upgrade_required',
        plan: profile?.plan ?? 'free',
      },
      { status: 402 }
    );
  }

  let name: string;
  try {
    const body = (await req.json()) as { name?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Team name required.' }, { status: 400 });
    }
    name = body.name.trim().slice(0, 80);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Create team.
  const { data: team, error: teamErr } = await sb
    .from('teams')
    .insert({ name, creator_id: user.id })
    .select('id, name, created_at')
    .maybeSingle();

  if (teamErr || !team) {
    return NextResponse.json({ error: teamErr?.message ?? 'Failed to create team.' }, { status: 500 });
  }

  // Add creator as owner member.
  await sb.from('team_members').insert({
    team_id: team.id as string,
    user_id: user.id,
    role: 'owner',
    joined_at: new Date().toISOString(),
  });

  return NextResponse.json({ team });
}
