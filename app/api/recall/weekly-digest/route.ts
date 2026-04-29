import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import {
  generateWeeklyDigest,
  formatWeeklyDigestMarkdown,
  lastCompleteWeek,
} from '@/lib/weekly-digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function OPTIONS() {
  return preflight();
}

type Body = { week?: unknown; force?: unknown };

const WEEK_RE = /^\d{4}-W\d{2}$/;

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) {
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Empty body is fine — defaults apply.
  }

  const week =
    typeof body.week === 'string' && WEEK_RE.test(body.week.trim())
      ? body.week.trim()
      : lastCompleteWeek();
  const force = body.force === true;

  const supabase = getSupabase();
  if (!supabase) {
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));
  }

  const result = await generateWeeklyDigest(
    supabase,
    auth.authed.userId,
    auth.authed.orgId ?? null,
    auth.authed.plan,
    { week, force }
  );

  if (!result.ok) {
    return withCors(
      NextResponse.json(
        {
          ok: false,
          week: result.week,
          skipped: result.skipped,
          error: result.error,
          coverage_window: result.coverageWindow,
        },
        { status: 200 }
      )
    );
  }

  return withCors(
    NextResponse.json({
      ok: true,
      id: result.id,
      week: result.week,
      cached: result.cached,
      payload: result.payload,
      coverage_window: result.coverageWindow,
      markdown: formatWeeklyDigestMarkdown(result.week, result.payload),
    })
  );
}
