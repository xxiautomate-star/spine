// Legacy entrypoint preserved for the 60+ existing callers. The real
// implementation lives at `lib/supabase/service.ts`. New code should import
// from `@/lib/supabase/service` directly — this file is a re-export only.

export { getSupabase } from './supabase/service';
