// Barrel exports for the consolidated Supabase clients.
//
// Three roles, three modules:
//   `./server`  — cookie-bound client for server components + route handlers
//   `./browser` — cookie-bound client for client components
//   `./service` — service-role admin client (bypasses RLS, server-only)
//
// Import from the specific module rather than this barrel when possible —
// it keeps the bundle smaller and the call site honest about which role
// the code is operating under.

export { getServerSupabase, getServerUser, isAuthConfigured } from './server';
export { getBrowserSupabase } from './browser';
export { getSupabase } from './service';
