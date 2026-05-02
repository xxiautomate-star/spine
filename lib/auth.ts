import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getSupabase } from './supabase';
import { isKeyScope, isExpired, scopeAllows, type KeyScope } from './auth-scope';

export type Plan = 'free' | 'pro' | 'team';

export type Authed = {
  userId: string;
  keyId: string;
  plan: Plan;
  orgId: string | null;
  scope: KeyScope;
  expiresAt: string | null;
};
export type AuthResult =
  | { authed: Authed; error?: never; status?: never }
  | { authed: null; error: string; status: number };

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function coercePlan(raw: unknown): Plan {
  return raw === 'pro' || raw === 'team' ? raw : 'free';
}

function coerceScope(raw: unknown): KeyScope {
  return isKeyScope(raw) ? raw : 'full';
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
    .select('id, user_id, scope, expires_at')
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

  // Expiry — caller can ask for a key with an expiry-date floor; we
  // enforce it here so every authed route gets the check for free.
  const expiresAt = (data.expires_at as string | null) ?? null;
  if (isExpired(expiresAt)) {
    return { authed: null, error: 'API key expired. Mint a new one.', status: 401 };
  }

  const scope = coerceScope(data.scope);

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

  // last_used_at is bumped via spine_log_key_use(...) below, called by
  // requireApiKeyWithScope after the route's scope check passes. We
  // skip the bare-update path used previously to avoid double-counting.

  return {
    authed: {
      userId,
      keyId: data.id as string,
      plan: coercePlan(profileRes.data?.plan),
      orgId,
      scope,
      expiresAt,
    },
  };
}

/**
 * Convenience wrapper around requireApiKey that ALSO checks the key's
 * scope against what the route requires. Used by /api/recall (read),
 * /api/capture (write), etc. Routes that haven't migrated to scope
 * enforcement still call requireApiKey directly and accept any scope.
 *
 * Side effect: on a successful auth+scope check, fire-and-forgets a
 * receipt row to the api_key_uses table. The route's own response code
 * is logged separately by the caller via logKeyReceipt() below — this
 * helper logs only the AUTH outcome (200 if pass, 401/403 on reject).
 */
export async function requireApiKeyWithScope(
  req: NextRequest,
  required: KeyScope
): Promise<AuthResult> {
  const auth = await requireApiKey(req);
  if (!auth.authed) {
    return auth;
  }
  if (!scopeAllows(auth.authed.scope, required)) {
    // 403 not 401 — the key is valid but lacks permission. Distinct
    // from "unknown key" so clients can surface a useful error.
    return {
      authed: null,
      error: `API key scope '${auth.authed.scope}' does not permit '${required}'. Mint a key with the correct scope.`,
      status: 403,
    };
  }
  return auth;
}

/**
 * Best-effort: insert a row into api_key_uses + bump api_keys.use_count
 * + last_used_at. Call this from each route AFTER the response code is
 * known so the receipt carries the real status.
 *
 * Failures are swallowed — receipts are observability, not correctness.
 */
export function logKeyReceipt(input: {
  keyId: string;
  userId: string;
  route: string;
  scopeRequired: KeyScope | null;
  statusCode: number;
}): void {
  const sb = getSupabase();
  if (!sb) return;
  void sb
    .rpc('spine_log_key_use', {
      p_key_id: input.keyId,
      p_user_id: input.userId,
      p_route: input.route,
      p_scope: input.scopeRequired,
      p_status: input.statusCode,
    })
    .then(() => {
      /* fire-and-forget */
    });
}

export type { KeyScope } from './auth-scope';
