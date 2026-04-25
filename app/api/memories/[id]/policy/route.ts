// PATCH /api/memories/[id]/policy
// Body: { visibility?: 'private' | 'team' | 'org', required_context?: boolean }
// Updates visibility or required_context flag. Owners and team owners can set required_context.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_VISIBILITY = ['private', 'team', 'org'] as const;
type Visibility = (typeof VALID_VISIBILITY)[number];

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

  let body: { visibility?: unknown; required_context?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.visibility !== undefined) {
    if (!VALID_VISIBILITY.includes(body.visibility as Visibility)) {
      return NextResponse.json(
        { error: 'visibility must be private, team, or org.' },
        { status: 400 }
      );
    }
    patch.visibility = body.visibility;
  }

  if (body.required_context !== undefined) {
    if (typeof body.required_context !== 'boolean') {
      return NextResponse.json({ error: 'required_context must be boolean.' }, { status: 400 });
    }
    patch.required_context = body.required_context;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('memories')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id, visibility, required_context')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Memory not found.' }, { status: 404 });

  return NextResponse.json({ ok: true, memory: data });
}
