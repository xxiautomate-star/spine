import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getSupabase } from './supabase';

export type Plan = 'free' | 'pro' | 'team';

export type Authed = { userId: string; keyId: string; plan: Plan; orgId: string | null };
export type AuthResult =
  | { authed: Authed; error?: never; status?: never }
  | { authed: null; error: string; status: number };

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function coercePlan(raw: unknown): Plan {
  return raw === 'pro' || raw === 'team' ? raw : 'free';
}

export async function requireApiKey(req: NextRequest): Promise<AuthResult> {
  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { authed: null, error: 'Missing bearer token.', status: 401 };
  }
  const key = header.slice(7).trim();
  if (!key.startsWith('spine_live_')) {
    return { authed: null, error: 'Invalid key format.', status: 401 };
  }
  const supabase = getSupabase();
  if (!supabase) {
    return { authed: null, error: 'Server not configured for cloud sync.', status: 500 };
  }
  const keyHash = hashApiKey(key);
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error || !data) {
    return { authed: null, error: 'Unknown API key.', status: 401 };
  }
  // Defensive: if an api_keys row exists but has a null user_id (orphaned
  // row from a deleted user, or schema bug), reject. Without this, downstream
  // routes would attribute writes to user_id=null which bypasses every
  // tenant-scoping filter.
  const userId = data.user_id as string | null;
  if (!userId) {
    return { authed: null, error: 'Unknown API key.', status: 401 };
  }

  // Fetch plan + default org in parallel
  const [profileRes, orgRes] = await Promise.all([
    supabase.from('profiles').select('plan').eq('user_id', userId).maybeSingle(),
    supabase
      .from('profiles')
      .select('default_org_id')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  // Fire-and-forget: ensure default org exists for new users
  const orgId = (orgRes.data?.default_org_id as string | null) ?? null;
  if (!orgId) {
    void supabase.rpc('spine_ensure_default_org', { p_user_id: userId }).then(() => void 0);
  }

  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id as string)
    .then(() => {/* best-effort */});

  return {
    authed: {
      userId,
      keyId: data.id as string,
      plan: coercePlan(profileRes.data?.plan),
      orgId,
    },
  };
}
