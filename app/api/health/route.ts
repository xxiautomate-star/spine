/**
 * /api/health — public health-check endpoint.
 *
 * No auth required. Used by uptime monitoring and stale-deploy detection.
 * Returns DB connectivity + commit SHA so we can tell at a glance whether
 * production is on the latest build.
 *
 * Shape:
 *   {
 *     ok: true,
 *     commit: "abcd1234",
 *     deployed_at: "2026-05-04T12:00:00Z",
 *     db_connected: true,
 *     embedder_configured: true
 *   }
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMIT_SHA =
  process.env.GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COOLIFY_DEPLOYMENT_UUID ??
  'unknown';

const DEPLOYED_AT = process.env.DEPLOYED_AT ?? new Date().toISOString();

export async function GET() {
  let dbConnected = false;
  let dbError: string | null = null;
  try {
    const sb = getSupabase();
    if (sb) {
      // Cheap probe: count rows in spine_memories with HEAD-only request.
      const { error } = await sb.from('memories').select('*', { count: 'exact', head: true });
      if (error) {
        dbError = error.message;
      } else {
        dbConnected = true;
      }
    } else {
      dbError = 'Supabase env vars missing';
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const body = {
    ok: dbConnected,
    commit: COMMIT_SHA,
    deployed_at: DEPLOYED_AT,
    db_connected: dbConnected,
    db_error: dbError,
    embedder_configured: Boolean(process.env.OPENAI_API_KEY),
    anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    paypal_configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbConnected ? 200 : 503,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
