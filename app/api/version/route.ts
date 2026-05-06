/**
 * /api/version — public version stamp.
 *
 * No auth required. Returns the commit SHA + deploy time so curl/grep can
 * tell at a glance whether production is stale. Add this as a UptimeRobot
 * keyword check ("commit:") to be alerted when a deploy didn't actually push.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMIT_SHA =
  process.env.GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COOLIFY_DEPLOYMENT_UUID ??
  'unknown';

const DEPLOYED_AT = process.env.DEPLOYED_AT ?? new Date().toISOString();

export async function GET() {
  return NextResponse.json(
    {
      commit: COMMIT_SHA,
      deployed_at: DEPLOYED_AT,
      timestamp: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store, max-age=0' } }
  );
}
