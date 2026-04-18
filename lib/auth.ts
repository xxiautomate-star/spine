import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getSupabase } from './supabase';

export type Authed = { userId: string; keyId: string };
export type AuthResult =
  | { authed: Authed; error?: never; status?: never }
  | { authed: null; error: string; status: number };

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
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
  void supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id as string)
    .then(() => {/* best-effort */});
  return { authed: { userId: data.user_id as string, keyId: data.id as string } };
}
