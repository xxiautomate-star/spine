// POST /api/integrations/slack — save Slack webhook for morning briefing
// GET  /api/integrations/slack — return masked webhook status

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data } = await sb
    .from('profiles')
    .select('slack_webhook, briefing_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  const webhook = data?.slack_webhook as string | null;
  return NextResponse.json({
    configured: !!webhook,
    masked: webhook ? `https://hooks.slack.com/services/…${webhook.slice(-12)}` : null,
    briefingEnabled: (data?.briefing_enabled as boolean | null) ?? true,
  });
}

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: { webhook?: unknown; briefingEnabled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Validate webhook format
  if (body.webhook !== undefined && body.webhook !== null) {
    if (typeof body.webhook !== 'string') {
      return NextResponse.json({ error: 'webhook must be a string.' }, { status: 400 });
    }
    if (body.webhook && !body.webhook.startsWith('https://hooks.slack.com/')) {
      return NextResponse.json({ error: 'Must be a Slack Incoming Webhook URL.' }, { status: 400 });
    }
    // Test the webhook with a ping
    if (body.webhook) {
      try {
        const testRes = await fetch(body.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Spine connected ✓ Morning briefings will arrive at 8am.' }),
        });
        if (!testRes.ok) {
          return NextResponse.json({ error: 'Slack webhook test failed — check the URL.' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Could not reach Slack webhook.' }, { status: 400 });
      }
    }
  }

  const update: Record<string, unknown> = {};
  if (body.webhook !== undefined) {
    update.slack_webhook = body.webhook || null;
  }
  if (typeof body.briefingEnabled === 'boolean') {
    update.briefing_enabled = body.briefingEnabled;
  }

  const { error } = await sb
    .from('profiles')
    .update(update)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, message: 'Slack integration saved.' });
}

export async function DELETE() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { error } = await sb
    .from('profiles')
    .update({ slack_webhook: null })
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
