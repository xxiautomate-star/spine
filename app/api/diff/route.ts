import { NextRequest, NextResponse } from 'next/server';
import { getServerUser, getServerSupabase } from '@/lib/supabase-server';
import { explainDiff } from '@/lib/code-diff-explainer';
import { withCors, preflight } from '@/lib/cors';

export const dynamic = 'force-dynamic';
// GitHub diff fetch + Haiku call can take up to 20s on large PRs
export const maxDuration = 30;

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return withCors(NextResponse.json({ error: 'url is required' }, { status: 400 }));
  }

  const result = await explainDiff(user.id, url);
  return withCors(NextResponse.json(result));
}
