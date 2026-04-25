import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { KeysClient, type KeyRow } from './KeysClient';

export const dynamic = 'force-dynamic';

async function fetchKeys(): Promise<KeyRow[]> {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) return [];
  const { data } = await supabase
    .from('api_keys')
    .select('id, name, created_at, last_used_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return (data ?? []) as KeyRow[];
}

export default async function KeysPage() {
  const keys = await fetchKeys();

  return (
    <main>
      <section className="px-6 md:px-16 pt-24 pb-24">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 002 &middot; Keys
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Your keys.
          </h1>
          <p className="text-cream/60 text-lg max-w-xl leading-relaxed mb-16">
            An API key connects Claude Code, Cursor, or any MCP client to this archive. Keys are
            shown once — store yours somewhere safe.
          </p>

          <KeysClient initialKeys={keys} />
        </div>
      </section>
    </main>
  );
}
