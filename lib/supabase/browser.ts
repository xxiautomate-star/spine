'use client';

// Browser-side Supabase client — for client components. Uses the cookie-bound
// auth flow so the same session as the server reads/writes from the browser.
// Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
//
// Cached so repeated `getBrowserSupabase()` calls in the same React tree
// don't spin up multiple websocket connections.
//
// Table-prefix translation matches `service.ts` and `server.ts` —
// `from('memories')` becomes `from('spine_memories')` automatically. The
// prefix is read from `NEXT_PUBLIC_SPINE_TABLE_PREFIX` (browser-visible) and
// falls back to `spine_`.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

const UNPREFIXED_TABLES = new Set<string>([]);

function applyPrefix(name: string, prefix: string): string {
  if (!prefix) return name;
  if (UNPREFIXED_TABLES.has(name)) return name;
  if (name.startsWith(prefix)) return name;
  return prefix + name;
}

function wrapWithPrefix(client: SupabaseClient, prefix: string): SupabaseClient {
  if (!prefix) return client;
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'from' && typeof value === 'function') {
        return (table: string, ...rest: unknown[]) => {
          const translated = applyPrefix(table, prefix);
          return (value as (...args: unknown[]) => unknown).call(target, translated, ...rest);
        };
      }
      return typeof value === 'function' ? (value as Function).bind(target) : value;
    },
  }) as SupabaseClient;
}

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const raw = createBrowserClient(url, anon);
  const prefix = process.env.NEXT_PUBLIC_SPINE_TABLE_PREFIX ?? 'spine_';
  cached = wrapWithPrefix(raw, prefix);
  return cached;
}
