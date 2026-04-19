// POST /api/memories/bulk-delete
// Session-authed hard delete of many memories at once. Ownership is enforced
// by matching user_id on the delete; RLS + the service-role client both
// agree on the same predicate. Returns the count actually deleted.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_REQUEST = 500;

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array.' }, { status: 400 });
  }
  if (body.ids.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PER_REQUEST} ids per request.` },
      { status: 400 }
    );
  }

  const ids = body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No valid ids provided.' }, { status: 400 });
  }

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { error, count } = await admin
    .from('memories')
    .delete({ count: 'exact' })
    .eq('user_id', user.id)
    .in('id', ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: count ?? 0 });
}
