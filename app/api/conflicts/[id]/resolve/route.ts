// PATCH /api/conflicts/[id]/resolve
// Body: { resolution: 'keep_latest' | 'keep_both' | 'merged' }
// Resolves a conflict. For keep_latest, soft-deletes the older memory.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_RESOLUTIONS = ['keep_latest', 'keep_both', 'merged'] as const;
type Resolution = (typeof VALID_RESOLUTIONS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let resolution: Resolution;
  try {
    const body = (await req.json()) as { resolution?: unknown };
    if (!VALID_RESOLUTIONS.includes(body.resolution as Resolution)) {
      return NextResponse.json(
        { error: 'resolution must be keep_latest, keep_both, or merged.' },
        { status: 400 }
      );
    }
    resolution = body.resolution as Resolution;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  // Verify conflict belongs to this user and is unresolved.
  const { data: conflict } = await sb
    .from('memory_conflicts')
    .select('id, memory_id_a, memory_id_b, resolution')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!conflict) return NextResponse.json({ error: 'Conflict not found.' }, { status: 404 });
  if (conflict.resolution) return NextResponse.json({ error: 'Already resolved.' }, { status: 409 });

  // For keep_latest: soft-delete the older memory (memory_id_a = prior).
  if (resolution === 'keep_latest') {
    await sb
      .from('memories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', conflict.memory_id_a as string)
      .eq('user_id', user.id);
  }

  // Mark conflict resolved.
  await sb
    .from('memory_conflicts')
    .update({ resolution, resolved_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({ ok: true, resolution });
}
