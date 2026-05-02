import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { KeysClient, type KeyRow } from './KeysClient';

export const dynamic = 'force-dynamic';

async function fetchKeys(): Promise<KeyRow[]> {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) return [];
  const { data } = await supabase
    .from('api_keys')
    .select('id, name, scope, expires_at, use_count, created_at, last_used_at')
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
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50 mb-3">
            Advanced &middot; API keys
          </p>
          <h1 className="font-serif text-4xl md:text-6xl leading-[1.0] text-cream mb-6">
            Manual keys.
          </h1>
          <p className="text-cream/55 text-base max-w-xl leading-relaxed mb-10">
            Most users don&apos;t need this page. <code className="font-mono text-[12px] text-amber/80 px-1">npx @spine/mcp init</code> opens a browser, you sign in, click approve — the CLI receives a key automatically. No copy-paste.
          </p>

          {/* Recommendation card — guide the user back to device flow */}
          <div className="mb-14 p-6 border border-amber/30 rounded-xl bg-amber/[0.03]">
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/80 mb-3">
              Recommended &middot; one command
            </p>
            <pre className="font-mono text-[13px] text-amber/90 mb-4 overflow-x-auto">npx @spine/mcp init</pre>
            <p className="text-cream/65 text-[14px] leading-relaxed">
              Opens a browser, you click approve, the CLI receives the key invisibly + writes config + registers with Claude Code. Same flow as <span className="text-cream/85">stripe login</span> or <span className="text-cream/85">gh auth login</span>.
            </p>
          </div>

          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
            When you actually need a manual key
          </p>
          <ul className="text-cream/55 text-[14px] leading-relaxed space-y-1.5 mb-12 max-w-xl">
            <li>— CI / GitHub Actions (no browser to open)</li>
            <li>— Headless servers (no browser to open)</li>
            <li>— Programmatic access from your own scripts</li>
            <li>— Rotating credentials on a schedule</li>
          </ul>

          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45 mb-6 pt-10 border-t border-cream/[0.08]">
            Existing keys
          </p>
          <KeysClient initialKeys={keys} />
        </div>
      </section>
    </main>
  );
}
