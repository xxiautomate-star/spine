// POST /api/cron/morning-briefing
// Runs daily at 8am UTC (configure in Coolify/GitHub Actions).
// For each user with briefing_enabled, sends Slack + email digest.

import { NextResponse, type NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { gatherBriefingData, sendSlackBriefing, sendEmailBriefing } from '@/lib/morning-briefing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  // Fetch all users with briefings enabled
  const { data: profiles, error } = await sb
    .from('profiles')
    .select('user_id, briefing_enabled, slack_webhook')
    .eq('briefing_enabled', true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { total: 0, slack: 0, email: 0, errors: 0 };

  for (const profile of profiles ?? []) {
    const userId = profile.user_id as string;
    try {
      // Get user email from auth.users (via service role)
      const { data: authUser } = await sb.auth.admin.getUserById(userId);
      const userEmail = authUser?.user?.email;
      if (!userEmail) continue;

      const data = await gatherBriefingData(sb, userId, userEmail);

      // Skip users with zero activity and no streak
      if (data.yesterday.total === 0 && data.streakDays === 0 && data.unresolvedDecisions === 0) continue;

      results.total++;

      // Slack
      if (data.slackWebhook) {
        const ok = await sendSlackBriefing(data.slackWebhook, data, dateLabel);
        if (ok) results.slack++;
      }

      // Email (always if they have a Resend key configured)
      const emailOk = await sendEmailBriefing(data, dateLabel);
      if (emailOk) results.email++;

    } catch {
      results.errors++;
    }
  }

  return NextResponse.json({ ok: true, ...results, dateLabel });
}

// Vercel cron sends GET with the bearer token. Same handler.
export async function GET(req: NextRequest) {
  return POST(req);
}
