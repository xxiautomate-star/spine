// POST /api/hygiene/dedupe/resolve
// Pro/Power only. Acts on a single memory_duplicates pair. Actions:
//   keep_a    — hard-delete memory B; mark pair resolved
//   keep_b    — hard-delete memory A; mark pair resolved
//   keep_both — just mark the pair resolved (user judged them not duplicates)

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Action = 'keep_a' | 'keep_b' | 'keep_both';

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data: profile } = await admin
    .from('profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle();
  const plan = profile?.plan === 'pro' || profile?.plan === 'team' ? profile.plan : 'free';
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Merging duplicates requires Pro or Power.', error_code: 'plan_upgrade_required' },
      { status: 402 }
    );
  }

  let body: { pair_id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const pairId = typeof body.pair_id === 'string' ? body.pair_id : '';
  const action = body.action as Action;
  if (!pairId || !['keep_a', 'keep_b', 'keep_both'].includes(action)) {
    return NextResponse.json({ error: 'pair_id and action are required.' }, { status: 400 });
  }

  const { data: pair, error: pairErr } = await admin
    .from('memory_duplicates')
    .select('id, user_id, memory_id_a, memory_id_b, resolved_at')
    .eq('id', pairId)
    .maybeSingle();
  if (pairErr) return NextResponse.json({ error: pairErr.message }, { status: 500 });
  if (!pair || pair.user_id !== user.id) {
    return NextResponse.json({ error: 'Pair not found.' }, { status: 404 });
  }
  if (pair.resolved_at) {
    return NextResponse.json({ error: 'Pair already resolved.' }, { status: 409 });
  }

  if (action !== 'keep_both') {
    const doomed = action === 'keep_a' ? pair.memory_id_b : pair.memory_id_a;
    const { error: delErr } = await admin
      .from('memories')
      .delete()
      .eq('user_id', user.id)
      .eq('id', doomed);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const { error: resErr } = await admin
    .from('memory_duplicates')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', pairId);
  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, action });
}
