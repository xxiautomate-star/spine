import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 80;

function validWeight(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const { data, error } = await sb
    .from('saas_spine_weight_profiles')
    .select('id, name, bm25_w, vec_w, recency_w, centrality_w, bias, notes, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  let body: {
    name?: unknown;
    bm25_w?: unknown;
    vec_w?: unknown;
    recency_w?: unknown;
    centrality_w?: unknown;
    bias?: unknown;
    notes?: unknown;
    activate?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (!validWeight(body.bm25_w) || !validWeight(body.vec_w) || !validWeight(body.recency_w) || !validWeight(body.centrality_w)) {
    return NextResponse.json({ error: 'weights must be numbers in [0, 1]' }, { status: 400 });
  }

  const row = {
    user_id: user.id,
    name,
    bm25_w: body.bm25_w as number,
    vec_w: body.vec_w as number,
    recency_w: body.recency_w as number,
    centrality_w: body.centrality_w as number,
    bias: typeof body.bias === 'number' ? (body.bias as number) : 0,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null,
  };

  const { data, error } = await sb
    .from('saas_spine_weight_profiles')
    .upsert(row, { onConflict: 'user_id,name' })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If activate=true, also write these weights as the user's active ranker row.
  if (body.activate === true) {
    await sb
      .from('spine_rerank_weights')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);

    await sb.from('spine_rerank_weights').insert({
      user_id: user.id,
      bm25_w: row.bm25_w,
      vec_w: row.vec_w,
      recency_w: row.recency_w,
      centrality_w: row.centrality_w,
      bias: row.bias,
      model_version: `profile:${name}`,
      training_n: 0,
      is_active: true,
      notes: `activated from /spine/why at ${new Date().toISOString()}`,
    });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await sb
    .from('saas_spine_weight_profiles')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
