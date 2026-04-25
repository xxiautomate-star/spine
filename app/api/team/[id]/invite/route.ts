// POST /api/team/[id]/invite
// Body: { email: string }
// Creates a pending invite with a token; sends invite email via Resend.
// Only team owners can invite.

import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { sendEmail, FROM_ADDRESS, wrapEmail } from '@/lib/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateToken(): string {
  return randomBytes(24).toString('hex');
}

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

  // Verify requester is owner of this team.
  const { data: membership } = await sb
    .from('team_members')
    .select('role')
    .eq('team_id', id)
    .eq('user_id', user.id)
    .not('joined_at', 'is', null)
    .maybeSingle();

  if (!membership || (membership.role as string) !== 'owner') {
    return NextResponse.json({ error: 'Only team owners can invite members.' }, { status: 403 });
  }

  let email: string;
  try {
    const body = (await req.json()) as { email?: unknown };
    if (typeof body.email !== 'string' || !body.email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required.' }, { status: 400 });
    }
    email = body.email.toLowerCase().trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Check seat limit (Power = 5 seats max).
  const { count } = await sb
    .from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', id)
    .not('joined_at', 'is', null);

  if ((count ?? 0) >= 5) {
    return NextResponse.json({ error: 'Team is full (5 seat limit on Power plan).' }, { status: 402 });
  }

  const { data: team } = await sb
    .from('teams')
    .select('name')
    .eq('id', id)
    .maybeSingle();

  const teamName = (team?.name as string) ?? 'your team';
  const token = generateToken();

  // Upsert invite row.
  await sb.from('team_members').upsert(
    {
      team_id: id,
      invited_email: email,
      invite_token: token,
      role: 'member',
    },
    { onConflict: 'invite_token', ignoreDuplicates: false }
  );

  const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://spine.xxiautomate.com';
  const inviteUrl = `${dashboardUrl}/team/join?token=${token}`;

  const html = wrapEmail(`You're invited to ${teamName} on Spine`, `
    <h1>You've been invited.</h1>
    <p class="sub">${teamName} on Spine</p>
    <div class="card">
      <p>You've been invited to join <strong>${teamName}</strong> on Spine — a shared memory space where your team's AI conversations build a collective archive.</p>
    </div>
    <a href="${inviteUrl}" class="cta" style="margin-top:24px;display:inline-block;">Accept invite →</a>
    <p style="margin-top:16px;font-size:11px;color:rgba(232,228,221,0.25);font-family:'Courier New',monospace;">This link expires in 7 days.</p>
  `);

  await sendEmail({
    from: FROM_ADDRESS,
    to: email,
    subject: `You're invited to ${teamName} on Spine`,
    html,
    text: `You've been invited to join ${teamName} on Spine. Accept: ${inviteUrl}`,
  });

  return NextResponse.json({ ok: true, invited: email });
}
