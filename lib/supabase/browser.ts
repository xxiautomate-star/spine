'use client';

// Browser-side Supabase client — for client components. Uses the cookie-bound
// auth flow so the same session as the server reads/writes from the browser.
// Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
//
// Cached so repeated `getBrowserSupabase()` calls in the same React tree
// don't spin up multiple websocket connections.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  cached = createBrowserClient(url, anon);
  return cached;
}
