// Legacy entrypoint preserved for the existing server-component +
// route-handler callers. The real implementation lives at
// `lib/supabase/server.ts`. New code should import from
// `@/lib/supabase/server` directly.

export { getServerSupabase, getServerUser, isAuthConfigured } from './supabase/server';
