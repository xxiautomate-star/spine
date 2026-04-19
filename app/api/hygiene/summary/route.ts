// GET /api/hygiene/summary
// Bearer-auth hygiene counts for MCP clients + the browser extension.
// Cheap head-count queries, no heavy content fetching. Used by
// spine_hygiene to show a "tend your archive" nudge without touching
// the full dashboard payload.
//
// Caching: payload is wrapped in unstable_cache keyed by userId with the
// 'hygiene' tag and a 60s revalidate window. /api/capture calls
// revalidateTag('hygiene') after every insert so extension polling sees
// fresh counts the moment they change. Response carries
// Cache-Control: private, max-age=60, stale-while-revalidate=300.

import { NextResponse, type NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_MIN_AGE_DAYS = 30;

type Summary = {
  plan: string;
  duplicatesPending: number;
  staleCount: number;
  clusterCount: number;
  largestCluster: { label: string; size: number } | null;
};

// Keyed by userId — each user gets an independent cache entry. Tagged
// globally as 'hygiene' so /api/capture can revalidate every user's
// entry with a single call; acceptable because the query is four cheap
// head counts and invalidation happens at most once per capture.
async function fetchSummary(userId: string, plan: string): Promise<Summary> {
  const admin = getSupabase();
  if (!admin) throw new Error('Server not configured.');

  const cutoff = new Date(Date.now() - STALE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [dupRes, staleRes, clusterRes, largestRes] = await Promise.all([
    admin
      .from('memory_duplicates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('resolved_at', null),
    admin
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .is('last_retrieved_at', null)
      .eq('retrieval_count', 0)
      .lte('created_at', cutoff),
    admin
      .from('memory_clusters')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    admin
      .from('memory_clusters')
      .select('label, size')
      .eq('user_id', userId)
      .order('size', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    plan,
    duplicatesPending: dupRes.count ?? 0,
    staleCount: staleRes.count ?? 0,
    clusterCount: clusterRes.count ?? 0,
    largestCluster: largestRes.data
      ? {
          label: (largestRes.data as { label: string }).label,
          size: (largestRes.data as { size: number }).size,
        }
      : null,
  };
}

const cachedSummary = unstable_cache(
  (userId: string, plan: string) => fetchSummary(userId, plan),
  ['hygiene-summary'],
  { revalidate: 60, tags: ['hygiene'] }
);

const CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300';

export async function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  let summary: Summary;
  try {
    summary = await cachedSummary(auth.authed.userId, auth.authed.plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error.';
    return withCors(NextResponse.json({ error: message }, { status: 500 }));
  }

  const res = NextResponse.json(summary);
  res.headers.set('Cache-Control', CACHE_CONTROL);
  return withCors(res);
}
