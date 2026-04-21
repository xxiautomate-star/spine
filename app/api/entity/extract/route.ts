// POST /api/entity/extract
// Manually trigger entity extraction for a specific memory or the last N.
// Used for back-fill and debugging. Auth: session cookie.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { extractAndIndex, batchExtract } from '@/lib/entity-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let body: { memory_id?: string; last_n?: number };
  try {
    body = (await req.json()) as { memory_id?: string; last_n?: number };
  } catch {
    body = {};
  }

  // Single memory extraction.
  if (typeof body.memory_id === 'string') {
    const { data, error } = await sb
      .from('memories')
      .select('id, content')
      .eq('id', body.memory_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data)
      return NextResponse.json({ error: 'Memory not found.' }, { status: 404 });

    const mem = data as { id: string; content: string };
    const result = await extractAndIndex(sb, user.id, mem.id, mem.content);
    return NextResponse.json({ extracted: 1, result });
  }

  // Batch: last N memories without entity extraction yet.
  const n = typeof body.last_n === 'number' ? Math.min(body.last_n, 100) : 20;
  const { data: memories } = await sb
    .from('memories')
    .select('id, content')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(n);

  const mems = (memories ?? []) as { id: string; content: string }[];
  const stats = await batchExtract(sb, user.id, mems);
  return NextResponse.json({ extracted: mems.length, stats });
}
