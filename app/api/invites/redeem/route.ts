import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getServerUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Validates a code for display. Does NOT consume it — consumption happens
// post-signup via POST when the user has an auth session.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.trim() ?? '';
  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase() ?? '';
  if (!code) return NextResponse.json({ valid: false, error: 'missing code' }, { status: 400 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ valid: false, error: 'not configured' }, { status: 503 });

  const { data } = await supabase
    .from('invite_codes')
    .select('code, email, plan_grant, expires_at, redeemed_at')
    .eq('code', code)
    .maybeSingle();

  if (!data) return NextResponse.json({ valid: false, reason: 'unknown' });
  if (data.redeemed_at) return NextResponse.json({ valid: false, reason: 'used' });
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ valid: false, reason: 'expired' });
  }
  if (email && data.email.toLowerCase() !== email) {
    return NextResponse.json({ valid: false, reason: 'email_mismatch' });
  }

  return NextResponse.json({
    valid: true,
    email: data.email,
    plan: data.plan_grant,
  });
}

// Consumes the code after the user has signed up. Requires an auth session.
export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });

  let body: { code?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) return NextResponse.json({ ok: false, error: 'code required' }, { status: 400 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 });

  const { data: invite } = await supabase
    .from('invite_codes')
    .select('code, email, plan_grant, expires_at, redeemed_at')
    .eq('code', code)
    .maybeSingle();

  if (!invite) return NextResponse.json({ ok: false, error: 'unknown code' }, { status: 404 });
  if (invite.redeemed_at) return NextResponse.json({ ok: false, error: 'already used' }, { status: 409 });
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 });
  }
  if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'email does not match invite' }, { status: 403 });
  }

  const { error: redeemErr } = await supabase
    .from('invite_codes')
    .update({ redeemed_by: user.id, redeemed_at: new Date().toISOString() })
    .eq('code', code)
    .is('redeemed_at', null);
  if (redeemErr) {
    return NextResponse.json({ ok: false, error: redeemErr.message }, { status: 500 });
  }

  const { error: planErr } = await supabase.from('profiles').upsert(
    { user_id: user.id, plan: invite.plan_grant, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
  if (planErr) {
    return NextResponse.json({ ok: true, plan_updated: false, error: planErr.message });
  }

  return NextResponse.json({ ok: true, plan_updated: true, plan: invite.plan_grant });
}
