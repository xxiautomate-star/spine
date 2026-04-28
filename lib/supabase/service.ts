// Service-role Supabase client — bypasses RLS, used for server-side admin
// work where the route has already authenticated the caller via API key.
// Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (NOT the
// anon key — this client must never reach the browser).
//
// Cached so we don't spin up new connections for every request.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
