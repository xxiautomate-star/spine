import { NextRequest, NextResponse } from 'next/server';
import { getServerUser, getServerSupabase } from '@/lib/supabase-server';
import { crossRepoReason } from '@/lib/cross-repo-reasoner';
import { withCors, preflight } from '@/lib/cors';

export const dynamic = 'force-dynamic';

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  let body: { query?: string; repos?: string[] };
  try {
    body = (await req.json()) as { query?: string; repos?: string[] };
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return withCors(NextResponse.json({ error: 'query is required' }, { status: 400 }));
  }

  const result = await crossRepoReason(user.id, query, body.repos);
  return withCors(NextResponse.json(result));
}
