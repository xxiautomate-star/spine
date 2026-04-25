// POST /api/entity/merge
// Body: { proposal_id: string, survivor_id: string, undo?: true }
// Executes or undoes an entity merge.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { executeMerge, undoMerge } from '@/lib/entity-merger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let body: { proposal_id?: unknown; survivor_id?: unknown; undo?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (typeof body.proposal_id !== 'string') {
    return NextResponse.json({ error: 'proposal_id required.' }, { status: 400 });
  }

  if (body.undo === true) {
    const result = await undoMerge(sb, user.id, body.proposal_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, action: 'undone' });
  }

  if (typeof body.survivor_id !== 'string') {
    return NextResponse.json({ error: 'survivor_id required.' }, { status: 400 });
  }

  const result = await executeMerge(sb, user.id, body.proposal_id, body.survivor_id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, action: 'merged' });
}
