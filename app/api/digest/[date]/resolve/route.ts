// PATCH /api/digest/[date]/resolve
// Body: { item_type: 'question' | 'nag', item_index: number }
// Marks a digest item as resolved. Idempotent.

import { NextResponse, type NextRequest } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  let body: { item_type?: string; item_index?: number };
  try {
    body = (await req.json()) as { item_type?: string; item_index?: number };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (body.item_type !== 'question' && body.item_type !== 'nag') {
    return NextResponse.json({ error: 'item_type must be question or nag.' }, { status: 400 });
  }
  if (typeof body.item_index !== 'number') {
    return NextResponse.json({ error: 'item_index required.' }, { status: 400 });
  }

  // Look up digest by user + date.
  const { data: digest } = await sb
    .from('digests')
    .select('id')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle();

  if (!digest) return NextResponse.json({ error: 'Digest not found.' }, { status: 404 });

  await sb.from('digest_resolutions').upsert(
    {
      digest_id: digest.id as string,
      item_type: body.item_type,
      item_index: body.item_index,
    },
    { onConflict: 'digest_id,item_type,item_index', ignoreDuplicates: true }
  );

  return NextResponse.json({ ok: true });
}
