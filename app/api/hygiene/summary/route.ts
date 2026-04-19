// GET /api/hygiene/summary
// Bearer-auth hygiene counts for MCP clients + the browser extension.
// Cheap head-count queries, no heavy content fetching. Used by
// spine_hygiene to show a "tend your archive" nudge without touching
// the full dashboard payload.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_MIN_AGE_DAYS = 30;

export async function OPTIONS() {
  return preflight();
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  const admin = getSupabase();
  if (!admin)
    return withCors(NextResponse.json({ error: 'Server not configured.' }, { status: 500 }));

  const cutoff = new Date(Date.now() - STALE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [dupRes, staleRes, clusterRes, largestRes] = await Promise.all([
    admin
      .from('memory_duplicates')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId)
      .is('resolved_at', null),
    admin
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId)
      .is('deleted_at', null)
      .is('last_retrieved_at', null)
      .eq('retrieval_count', 0)
      .lte('created_at', cutoff),
    admin
      .from('memory_clusters')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.authed.userId),
    admin
      .from('memory_clusters')
      .select('label, size')
      .eq('user_id', auth.authed.userId)
      .order('size', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return withCors(
    NextResponse.json({
      plan: auth.authed.plan,
      duplicatesPending: dupRes.count ?? 0,
      staleCount: staleRes.count ?? 0,
      clusterCount: clusterRes.count ?? 0,
      largestCluster: largestRes.data
        ? {
            label: (largestRes.data as { label: string }).label,
            size: (largestRes.data as { size: number }).size,
          }
        : null,
    })
  );
}
