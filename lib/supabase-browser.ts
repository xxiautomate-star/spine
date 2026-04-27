// Legacy entrypoint preserved for the existing client-component callers.
// The real implementation lives at `lib/supabase/browser.ts`. New code
// should import from `@/lib/supabase/browser` directly.

export { getBrowserSupabase } from './supabase/browser';
