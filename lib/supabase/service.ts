// Service-role Supabase client — bypasses RLS, used for server-side admin
// work where the route has already authenticated the caller via API key.
// Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (NOT the
// anon key — this client must never reach the browser).
//
// Cached so we don't spin up new connections for every request.
//
// ── Table prefix translation ─────────────────────────────────────────────────
// Spine shares a Supabase project with autonomous-architect. Spine tables are
// prefixed `spine_*` to avoid collisions. App code references unprefixed names
// (`memories`, `api_keys`, `waitlist`, etc.) for readability — this wrapper
// applies the prefix automatically so callers don't have to. The prefix is
// configurable via `SPINE_TABLE_PREFIX` (default `spine_`). Set it to empty
// string in environments where Spine has its own dedicated Supabase project.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

// Tables that are NOT prefixed (managed by Supabase or shared with other apps
// that should be left alone). Add to this list if a non-prefixed table needs
// to be reachable through the same client.
const UNPREFIXED_TABLES = new Set<string>([
  // auth.users is reached via the auth client, not from() — but be explicit
  // about anything else that ever lives outside the spine_ namespace:
]);

function applyPrefix(name: string, prefix: string): string {
  if (!prefix) return name;
  if (UNPREFIXED_TABLES.has(name)) return name;
  if (name.startsWith(prefix)) return name; // already prefixed, idempotent
  return prefix + name;
}

function wrapWithPrefix(client: SupabaseClient, prefix: string): SupabaseClient {
  if (!prefix) return client;
  // Proxy so that `client.from('memories')` becomes `client.from('spine_memories')`
  // transparently. All other methods pass through.
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'from' && typeof value === 'function') {
        return (table: string, ...rest: unknown[]) => {
          const translated = applyPrefix(table, prefix);
          return (value as (...args: unknown[]) => unknown).call(target, translated, ...rest);
        };
      }
      if (prop === 'rpc' && typeof value === 'function') {
        // RPC names already mention prefix where needed in our codebase. Pass through.
        return (value as (...args: unknown[]) => unknown).bind(target);
      }
      return typeof value === 'function' ? (value as Function).bind(target) : value;
    },
  }) as SupabaseClient;
}

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const raw = createClient(url, key, { auth: { persistSession: false } });
  const prefix = process.env.SPINE_TABLE_PREFIX ?? 'spine_';
  cached = wrapWithPrefix(raw, prefix);
  return cached;
}
