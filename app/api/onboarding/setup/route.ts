// GET /api/onboarding/setup
// Returns (or bootstraps) everything a new user needs to complete onboarding:
//   - Their default org_id
//   - A new API key (raw, returned ONCE — stored in client sessionStorage)
//   - Their current memory count (to detect first capture)
//
// Idempotent: if called repeatedly only creates one org and one key per session.
// The response includes a fresh raw key only on first call (key_created: true).
// On subsequent calls key is null — user must use /dashboard/keys to create more.

import { NextResponse } from 'next/server';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { randomBytes } from 'node:crypto';
import { hashApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isAuthConfigured())
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });

  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // 1. Ensure default org
  const { data: orgId } = await sb.rpc('spine_ensure_default_org', { p_user_id: user.id });

  // 2. Check if user already has an API key
  const { count: keyCount } = await sb
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);

  let rawKey: string | null = null;
  let keyCreated = false;

  if ((keyCount ?? 0) === 0) {
    // First call — create and return raw key once
    rawKey = `spine_live_${randomBytes(18).toString('base64url')}`;
    const keyHash = hashApiKey(rawKey);
    await sb.from('api_keys').insert({
      user_id: user.id,
      key_hash: keyHash,
      name: 'Onboarding key',
    });
    keyCreated = true;
  }

  // 3. Memory count for "first capture" detection
  const { count: memCount } = await sb
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('deleted_at', null);

  return NextResponse.json({
    org_id: orgId as string,
    user_email: user.email ?? '',
    api_key: rawKey,           // raw key, only non-null on first call
    key_created: keyCreated,
    memory_count: memCount ?? 0,
  });
}
