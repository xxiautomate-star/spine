// GET /api/graph — returns the entity graph for the authenticated user.
// Auth: session cookie (dashboard page).
// Returns { nodes: EntityNode[], edges: EntityEdge[] }.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { entityGraph } from '@/lib/entity-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  try {
    const graph = await entityGraph(sb, user.id, 60);
    return NextResponse.json(graph);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Graph fetch failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
