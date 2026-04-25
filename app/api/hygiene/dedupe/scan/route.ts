// POST /api/hygiene/dedupe/scan
// Runs duplicate detection for the signed-in user and upserts pairs into
// memory_duplicates. Safe to run multiple times — existing pairs are kept
// (the unique constraint on (memory_id_a, memory_id_b) deduplicates).

import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_LIMIT = 300;

export async function POST() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data, error } = await admin.rpc('spine_detect_duplicates', {
    p_user: user.id,
    p_threshold: DEFAULT_THRESHOLD,
    p_limit: DEFAULT_LIMIT,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type PairRow = { memory_id_a: string; memory_id_b: string; similarity: number };
  const pairs = (data ?? []) as PairRow[];

  if (pairs.length === 0) {
    return NextResponse.json({ scanned: 0, inserted: 0 });
  }

  const rows = pairs.map((p) => ({
    user_id: user.id,
    memory_id_a: p.memory_id_a,
    memory_id_b: p.memory_id_b,
    similarity: p.similarity,
  }));

  const { error: upErr, count } = await admin
    .from('memory_duplicates')
    .upsert(rows, {
      onConflict: 'memory_id_a,memory_id_b',
      ignoreDuplicates: true,
      count: 'exact',
    });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ scanned: pairs.length, inserted: count ?? 0 });
}
