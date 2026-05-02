import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { hashApiKey } from '@/lib/auth';
import { isKeyScope, type KeyScope } from '@/lib/auth-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_SELECT = 'id, name, scope, expires_at, use_count, created_at, last_used_at';

function generateRawKey(): string {
  return `spine_live_${randomBytes(18).toString('base64url')}`;
}

// expiry presets the dashboard form ships. Mapped server-side so a
// caller can't ask for "10 years" by sending a custom date — only
// these named windows + null are accepted.
const EXPIRY_PRESETS: Record<string, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

function resolveExpiry(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined || raw === 'never') return null;
  if (typeof raw !== 'string') return 'invalid';
  const days = EXPIRY_PRESETS[raw];
  if (days === undefined) return 'invalid';
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const supabase = await getServerSupabase();
  if (!supabase) return NextResponse.json({ error: 'Not configured.' }, { status: 500 });

  const { data, error } = await supabase
    .from('api_keys')
    .select(KEY_SELECT)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: NextRequest) {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  let name: string | null = null;
  let scope: KeyScope = 'full';
  let expiresAt: string | null = null;
  try {
    const body = (await req.json()) as {
      name?: unknown;
      scope?: unknown;
      expiry?: unknown;
    };
    if (typeof body.name === 'string') name = body.name.trim().slice(0, 80) || null;
    if (isKeyScope(body.scope)) scope = body.scope;
    const expiryResult = resolveExpiry(body.expiry);
    if (expiryResult === 'invalid') {
      return NextResponse.json(
        { error: 'expiry must be one of: never, 30d, 90d, 1y' },
        { status: 400 }
      );
    }
    expiresAt = expiryResult;
  } catch {
    // allow empty body — defaults apply
  }

  const admin = getSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const raw = generateRawKey();
  const keyHash = hashApiKey(raw);

  const { data, error } = await admin
    .from('api_keys')
    .insert({
      user_id: user.id,
      key_hash: keyHash,
      name,
      scope,
      expires_at: expiresAt,
    })
    .select(KEY_SELECT)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed.' }, { status: 500 });
  }

  return NextResponse.json({ key: raw, row: data });
}
