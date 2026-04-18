import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data, error } = await supabase
    .from('memories')
    .update({ deleted_at: new Date().toISOString() })
    .eq('user_id', auth.authed.userId)
    .eq('id', id)
    .is('deleted_at', null)
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ forgotten: (data ?? []).length > 0 });
}
