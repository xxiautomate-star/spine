import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { from?: unknown; to?: unknown; limit?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const requested = typeof body.limit === 'number' ? body.limit : 50;
  const limit = Math.max(1, Math.min(500, Math.floor(requested)));

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let q = supabase
    .from('memories')
    .select('id, content, source, tags, created_at')
    .eq('user_id', auth.authed.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (typeof body.from === 'string') q = q.gte('created_at', body.from);
  if (typeof body.to === 'string') q = q.lte('created_at', body.to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const memories = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    tags: r.tags ?? [],
    createdAt: r.created_at,
  }));
  return NextResponse.json({ memories });
}
