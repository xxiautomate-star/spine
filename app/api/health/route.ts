/**
 * /api/health — public health-check endpoint.
 *
 * No auth required. Used by uptime monitoring and stale-deploy detection.
 * Returns DB connectivity + commit SHA so we can tell at a glance whether
 * production is on the latest build.
 *
 * `launch_ready` (added for the 2026-05-10 Sunday launch) is a single
 * bool that goes true only when every gate passes: DB up, embedder
 * configured, npm package live, benchmark cron firing recently, and
 * the corpus has at least one captured memory. Roman hits this Monday
 * morning before Show HN as a one-shot go/no-go check.
 *
 * Shape:
 *   {
 *     ok: true,
 *     commit, deployed_at,
 *     db_connected, db_error,
 *     embedder_configured, embedder_provider,
 *     anthropic_configured, paypal_configured,
 *     launch_ready: true,
 *     launch_gates: {
 *       db_connected: true,
 *       embedder_configured: true,
 *       npm_published: true,
 *       benchmark_recent: true,
 *       corpus_seeded: true
 *     },
 *     launch_blockers: ["..."],   // human-readable list, [] when ready
 *     timestamp
 *   }
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase/service';
import { embedderConfigured, defaultProvider } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMIT_SHA =
  process.env.GIT_SHA ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.COOLIFY_DEPLOYMENT_UUID ??
  'unknown';

const DEPLOYED_AT = process.env.DEPLOYED_AT ?? new Date().toISOString();

const NPM_PACKAGE = 'spine-mcp';
const NPM_CACHE_TTL_MS = 60_000;
let npmCache: { ts: number; ok: boolean; version: string | null } | null = null;

async function npmPublished(): Promise<{ ok: boolean; version: string | null }> {
  if (npmCache && Date.now() - npmCache.ts < NPM_CACHE_TTL_MS) {
    return { ok: npmCache.ok, version: npmCache.version };
  }
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`, {
      // Edge cache + 5s ceiling so a slow npm registry never wedges /api/health.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      npmCache = { ts: Date.now(), ok: false, version: null };
      return { ok: false, version: null };
    }
    const data = (await res.json()) as { version?: string };
    const version = data.version ?? null;
    npmCache = { ts: Date.now(), ok: Boolean(version), version };
    return { ok: Boolean(version), version };
  } catch {
    npmCache = { ts: Date.now(), ok: false, version: null };
    return { ok: false, version: null };
  }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET() {
  let dbConnected = false;
  let dbError: string | null = null;
  let benchmarkRecent = false;
  let corpusSeeded = false;

  try {
    const sb = getSupabase();
    if (sb) {
      // Three cheap probes in parallel: a HEAD count on memories (DB up
      // + corpus sanity), the latest benchmark_runs ts (cron freshness),
      // and a count of any captured memories anywhere (corpus seeded).
      const [memHead, latestBench, anyMemory] = await Promise.all([
        sb.from('memories').select('*', { count: 'exact', head: true }),
        sb
          .from('benchmark_runs')
          .select('ran_at')
          .order('ran_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from('memories')
          .select('id', { count: 'exact', head: true })
          .is('deleted_at', null)
          .limit(1),
      ]);

      if (memHead.error) {
        dbError = memHead.error.message;
      } else {
        dbConnected = true;
      }

      if (!latestBench.error && latestBench.data?.ran_at) {
        const age = Date.now() - new Date(latestBench.data.ran_at).getTime();
        benchmarkRecent = age < SEVEN_DAYS_MS;
      }

      // We can't easily distinguish "0 anywhere" from "0 visible to this
      // service role" but the service role bypasses RLS, so 0 here means
      // truly empty and the launch gate fails appropriately.
      corpusSeeded = (anyMemory.count ?? 0) > 0;
    } else {
      dbError = 'Supabase env vars missing';
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const npm = await npmPublished();

  const gates = {
    db_connected: dbConnected,
    embedder_configured: embedderConfigured(),
    npm_published: npm.ok,
    benchmark_recent: benchmarkRecent,
    corpus_seeded: corpusSeeded,
  };
  const launchReady = Object.values(gates).every(Boolean);
  const launchBlockers: string[] = [];
  if (!gates.db_connected) launchBlockers.push('DB connection failed: ' + (dbError ?? 'unknown'));
  if (!gates.embedder_configured) launchBlockers.push('Embedder not configured (set GEMINI_API_KEY or OPENAI_API_KEY)');
  if (!gates.npm_published) launchBlockers.push(`spine-mcp not visible on npm registry (or fetch timed out)`);
  if (!gates.benchmark_recent) launchBlockers.push('No benchmark_runs row in last 7 days — cron may not be firing');
  if (!gates.corpus_seeded) launchBlockers.push('No captured memories anywhere in spine_memories — capture path may be broken');

  const body = {
    ok: dbConnected,
    commit: COMMIT_SHA,
    deployed_at: DEPLOYED_AT,
    db_connected: dbConnected,
    db_error: dbError,
    embedder_configured: embedderConfigured(),
    embedder_provider: defaultProvider(),
    anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    paypal_configured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    launch_ready: launchReady,
    launch_gates: gates,
    launch_blockers: launchBlockers,
    npm_latest: npm.version,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbConnected ? 200 : 503,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}
