import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { hashApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateRawKey(): string {
  return `spine_live_${randomBytes(18).toString('base64url')}`;
}

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Not configured.' }, { status: 500 });

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let name: string | null = null;
  try {
    const body = (await req.json()) as { name?: unknown };
    if (typeof body.name === 'string') name = body.name.trim().slice(0, 80) || null;
  } catch {
    // allow empty body
  }

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const raw = generateRawKey();
  const keyHash = hashApiKey(raw);

  const { data, error } = await admin
    .from('api_keys')
    .insert({ user_id: user.id, key_hash: keyHash, name })
    .select('id, name, created_at, last_used_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 });
  }

  return NextResponse.json({ key: raw, row: data });
}
