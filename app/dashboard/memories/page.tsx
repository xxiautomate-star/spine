import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Memory = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
};

async function fetchMemories(): Promise<Memory[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from('memories')
      .select('id, content, source, tags, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    return (data ?? []) as Memory[];
  } catch {
    return [];
  }
}

function groupByDay(memories: Memory[]): [string, Memory[]][] {
  const groups = new Map<string, Memory[]>();
  for (const m of memories) {
    const day = m.created_at.slice(0, 10);
    const arr = groups.get(day) ?? [];
    arr.push(m);
    groups.set(day, arr);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatDay(day: string): string {
  try {
    const date = new Date(day + 'T00:00:00Z');
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return day;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(11, 16);
  }
}

export default async function MemoriesPage() {
  const memories = await fetchMemories();
  const groups = groupByDay(memories);

  return (
    <main className="min-h-screen">
      <header className="fixed top-0 inset-x-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/60 border-b border-cream/5">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
          Archive
        </span>
      </header>

      <section className="px-6 md:px-16 pt-36 pb-24">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 001 &middot; Archive
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Every word.
          </h1>
          <p className="text-cream/60 text-lg max-w-xl leading-relaxed mb-16">
            Your full corpus of memories. Append-only. Never summarised. Searchable by meaning — the raw
            sentence stays where you put it.
          </p>

          <form className="mb-20 border-b border-cream/15 pb-3" action="" method="get">
            <label htmlFor="q" className="sr-only">Search memories</label>
            <input
              id="q"
              name="q"
              type="search"
              placeholder="Search your memory — what did I tell it about the launch?"
              className="w-full bg-transparent focus:outline-none py-2 text-lg placeholder:text-cream/25"
            />
          </form>

          {groups.length === 0 ? (
            <div className="py-20 border border-cream/10 text-center">
              <p className="font-serif text-3xl md:text-4xl text-cream mb-3">
                No memories yet.
              </p>
              <p className="text-cream/50 max-w-md mx-auto mb-8">
                Install the MCP server in Claude Code and start talking. Every turn becomes a memory.
              </p>
              <pre className="inline-block font-mono text-sm bg-cream/[0.04] border border-cream/10 text-amber px-4 py-3">
                <span className="text-cream/40 select-none">$ </span>npx @spine/mcp init
              </pre>
            </div>
          ) : (
            <div className="space-y-16">
              {groups.map(([day, items]) => (
                <section key={day}>
                  <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-6">
                    {formatDay(day)}
                  </p>
                  <ul className="space-y-8">
                    {items.map((m) => (
                      <li
                        key={m.id}
                        className="border-l-2 border-amber/40 pl-6 py-1"
                      >
                        <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-2">
                          {formatTime(m.created_at)}
                          {m.source ? ` · ${m.source}` : ''}
                        </p>
                        <p className="font-serif text-lg md:text-xl text-cream/90 leading-relaxed">
                          {m.content}
                        </p>
                        {m.tags && m.tags.length > 0 && (
                          <p className="mt-3 font-mono text-[11px] text-cream/40">
                            {m.tags.map((t) => `#${t}`).join(' ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
