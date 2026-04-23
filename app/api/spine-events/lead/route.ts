import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Meta Conversions API bridge — no-op unless FB_CAPI_ACCESS_TOKEN + FB_PIXEL_ID are set.
// Fires a `Lead` event server-side for better attribution than browser-only fbq.

function sha256Lower(s: string) {
  return createHash('sha256').update(s.trim().toLowerCase()).digest('hex');
}

export async function POST(req: NextRequest) {
  let body: { email?: string; source?: string; event?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad body' }, { status: 400 });
  }

  const token = process.env.FB_CAPI_ACCESS_TOKEN;
  const pixel = process.env.FB_PIXEL_ID;
  if (!token || !pixel) {
    return NextResponse.json({ ok: true, relayed: false });
  }

  const email = typeof body.email === 'string' ? body.email : '';
  if (!email) return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? undefined;
  const ua = req.headers.get('user-agent') ?? undefined;
  const referer = req.headers.get('referer') ?? undefined;

  const payload = {
    data: [
      {
        event_name: body.event ?? 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: referer,
        action_source: 'website',
        user_data: {
          em: [sha256Lower(email)],
          client_ip_address: ip,
          client_user_agent: ua,
        },
        custom_data: {
          source: body.source ?? 'labs-spine',
        },
      },
    ],
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const ok = res.ok;
    return NextResponse.json({ ok, relayed: ok });
  } catch {
    return NextResponse.json({ ok: true, relayed: false });
  }
}
