import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { getSupabase } from '@/lib/supabase';
import { sendInviteEmail } from '@/lib/invite-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function genCode(): string {
  // 10 chars, url-safe-ish, avoid ambiguous 0/O/1/l
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const [waitlistRes, invitesRes] = await Promise.all([
    supabase
      .from('saas_spine_waitlist')
      .select('id, email, source, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('invite_codes')
      .select('code, email, issued_at, redeemed_at, plan_grant, waitlist_id')
      .order('issued_at', { ascending: false })
      .limit(500),
  ]);

  return NextResponse.json({
    waitlist: waitlistRes.data ?? [],
    invites: invitesRes.data ?? [],
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  let body: { email?: unknown; waitlist_id?: unknown; plan?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email required.' }, { status: 400 });
  }

  const waitlistId = typeof body.waitlist_id === 'string' ? body.waitlist_id : null;
  const plan = typeof body.plan === 'string' && ['free', 'pro', 'power'].includes(body.plan) ? body.plan : 'pro';
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null;

  const code = genCode();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const { error } = await supabase.from('invite_codes').insert({
    code,
    email,
    waitlist_id: waitlistId,
    issued_by: admin.userId,
    plan_grant: plan,
    expires_at: expiresAt,
    notes,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const origin = req.headers.get('origin') ?? req.nextUrl.origin;
  const inviteUrl = `${origin}/login?invite=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;

  const emailResult = await sendInviteEmail({
    to: email,
    code,
    plan,
    inviteUrl,
  });

  return NextResponse.json({
    ok: true,
    code,
    invite_url: inviteUrl,
    email_sent: emailResult.ok,
    email_error: emailResult.ok ? null : emailResult.error,
  });
}
