import { NextResponse, type NextRequest } from 'next/server';
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

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { email, tier_interest, use_case } = (body ?? {}) as {
    email?: unknown;
    tier_interest?: unknown;
    use_case?: unknown;
  };

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.length > 320) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }

  const validTiers = ['Free', 'Pro', 'Power', 'Team'];
  const tier = typeof tier_interest === 'string' && validTiers.includes(tier_interest) ? tier_interest : null;
  const useCase = typeof use_case === 'string' ? use_case.slice(0, 2000) : null;
  const referrer = req.headers.get('referer') ?? null;
  const normalisedEmail = email.trim().toLowerCase();

  const supabase = getSupabase();
  if (!supabase) {
    // 2026-05-04 fix: previously this returned `{ok:true, queued:true}` even
    // when env vars were missing, silently dropping every signup. Now we
    // return 503 so the frontend can surface a real failure.
    console.error('[waitlist] Supabase env vars missing — returning 503', {
      email: normalisedEmail,
    });
    return NextResponse.json(
      { error: 'Waitlist temporarily unavailable. Please try again shortly.' },
      { status: 503 }
    );
  }

  const { error } = await supabase.from('waitlist').insert({
    email: normalisedEmail,
    tier_interest: tier,
    use_case: useCase,
    referrer,
  });

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[waitlist] insert failed', error);
    return NextResponse.json({ error: 'Could not save. Try again in a moment.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
