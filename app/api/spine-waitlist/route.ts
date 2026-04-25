import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function hashIp(ip: string): string {
  const salt = process.env.SPINE_IP_SALT ?? 'spine-labs-v1';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a minute.' },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { email, source } = (body ?? {}) as { email?: unknown; source?: unknown };

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 320) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const normalisedEmail = email.trim().toLowerCase();
  const sourceStr = typeof source === 'string' ? source.slice(0, 80) : null;
  const referrer = req.headers.get('referer') ?? null;
  const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null;

  const supabase = getSupabase();
  if (!supabase) {
    console.warn('[spine-waitlist] Supabase env vars missing; accepting without persistence.', {
      email: normalisedEmail,
    });
    return NextResponse.json({ ok: true, queued: true });
  }

  const { error } = await supabase.from('saas_spine_waitlist').insert({
    email: normalisedEmail,
    source: sourceStr,
    referrer,
    user_agent: userAgent,
    ip_hash: hashIp(ip),
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[spine-waitlist] insert failed', error);
    return NextResponse.json(
      { error: 'Could not save. Try again in a moment.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
