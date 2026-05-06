// Server-side Supabase client — for server components, route handlers, and
// server actions. Uses the cookie-bound auth flow so RLS policies see the
// authenticated user. Reads `NEXT_PUBLIC_SUPABASE_URL` and
// `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the environment.
//
// This is the canonical home for the server-side cookie client. The legacy
// `@/lib/supabase-server` import path re-exports from here for backwards
// compatibility — new code should import from `@/lib/supabase/server`
// directly.
//
// Table-prefix translation is applied identically to `service.ts` so
// `from('memories')` resolves to `from('spine_memories')` automatically.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

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

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function getServerSupabase(): Promise<SupabaseClient | null> {
  if (!isAuthConfigured()) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  const store = await cookies();
  const raw = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet: CookieToSet[]) {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot mutate cookies; middleware handles refresh.
        }
      },
    },
  });
  const prefix = process.env.SPINE_TABLE_PREFIX ?? 'spine_';
  return wrapWithPrefix(raw, prefix);
}

export async function getServerUser(): Promise<User | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
