// GET /api/hygiene/stale
// Returns top-N stale cleanup candidates for the signed-in user.

import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { listStaleMemories } from '@/lib/hygiene';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const stale = await listStaleMemories(admin, user.id, 50);
  return NextResponse.json({ memories: stale });
}
