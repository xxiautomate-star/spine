import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getServerSupabase, getServerUser, isAuthConfigured } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Session — Spine',
};

type Row = {
  id: string;
  session_id: string;
  kind: 'turn' | 'digest' | null;
  content: string;
  source: string | null;
  tool_name: string | null;
  files_touched: string[] | null;
  created_at: string;
};

type DigestShape = {
  decisions?: string[];
  state?: string;
  open_threads?: string[];
  mistakes?: string[];
  files_touched?: string[];
  commits?: string[];
};

function parseDigest(content: string): DigestShape | null {
  try {
    const parsed = JSON.parse(content) as DigestShape;
    if (typeof parsed === 'object' && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}

function turnRoleFromContent(content: string): 'user' | 'assistant' | 'tool' | 'unknown' {
  if (content.startsWith('[user]') || content.startsWith('[user:')) return 'user';
  if (content.startsWith('[assistant]') || content.startsWith('[assistant:')) return 'assistant';
  if (content.startsWith('[tool]') || content.startsWith('[tool:')) return 'tool';
  return 'unknown';
}

function turnBody(content: string): string {
  const idx = content.indexOf(']');
  if (idx > 0 && content[0] === '[') return content.slice(idx + 1).trim();
  return content;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function fetchSession(userId: string, sessionId: string): Promise<Row[]> {
  const supabase = await getServerSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from('memories')
    .select('id, session_id, kind, content, source, tool_name, files_touched, created_at')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  return (data ?? []) as Row[];
}

export default async function SessionDetailPage(
  props: { params: Promise<{ id: string }> }
) {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');

  const { id } = await props.params;
  const sessionId = decodeURIComponent(id);
  const rows = await fetchSession(user.id, sessionId);
  if (rows.length === 0) notFound();

  const digestRow = rows.find((r) => r.kind === 'digest');
  const digest = digestRow ? parseDigest(digestRow.content) : null;
  const turns = rows.filter((r) => r.kind === 'turn');

  const firstSeen = rows[0].created_at;
  const lastSeen = rows[rows.length - 1].created_at;
  const shortId = sessionId.slice(0, 8);

  return (
    <main className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      <header className="border-b border-cream/[0.06] px-6 md:px-12 py-8">
        <div className="max-w-4xl mx-auto">
          <Link
            href="/sessions"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber transition-colors duration-300 inline-block mb-6"
          >
            ← All sessions
          </Link>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[0.95]">
            session {shortId}
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/35 mt-3">
            {formatTime(firstSeen)} — {formatTime(lastSeen)} · {turns.length} turn{turns.length === 1 ? '' : 's'}
            {digest && ' · digest'}
          </p>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 md:px-12 py-12 space-y-16">
        {digest && digestRow && (
          <article
            className="relative border-l-2 border-amber/60 pl-8 py-6 -ml-2"
            aria-labelledby="digest-heading"
          >
            <div
              className="absolute -left-[5px] top-8 w-2 h-2 rounded-full bg-amber"
              aria-hidden
            />
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/70 mb-4">
              Session digest · {formatTime(digestRow.created_at)}
            </p>

            {digest.state && (
              <h2
                id="digest-heading"
                className="font-serif text-2xl md:text-3xl text-cream leading-snug mb-8"
              >
                {digest.state}
              </h2>
            )}

            <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
              {digest.decisions && digest.decisions.length > 0 && (
                <DigestList label="Decisions" items={digest.decisions} accent="amber" />
              )}
              {digest.open_threads && digest.open_threads.length > 0 && (
                <DigestList label="Open threads" items={digest.open_threads} accent="cream" />
              )}
              {digest.mistakes && digest.mistakes.length > 0 && (
                <DigestList label="Mistakes" items={digest.mistakes} accent="rose" />
              )}
              {digest.commits && digest.commits.length > 0 && (
                <DigestList label="Commits" items={digest.commits} accent="cream" mono />
              )}
            </div>

            {digest.files_touched && digest.files_touched.length > 0 && (
              <div className="mt-10 pt-6 border-t border-cream/[0.05]">
                <p className="font-mono text-[10px] uppercase tracking-widest text-cream/35 mb-3">
                  Files touched
                </p>
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {digest.files_touched.map((f, i) => (
                    <li
                      key={i}
                      className="font-mono text-[11px] text-cream/55 break-all"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )}

        <div>
          <h2 className="font-serif text-2xl text-cream/85 mb-8">Turns</h2>
          {turns.length === 0 ? (
            <p className="font-mono text-[11px] text-cream/35">
              No individual turns captured for this session.
            </p>
          ) : (
            <ol className="space-y-6">
              {turns.map((t) => {
                const role = turnRoleFromContent(t.content);
                const body = turnBody(t.content);
                return (
                  <li key={t.id} className="grid grid-cols-[80px_1fr] gap-6">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30 pt-1">
                      {new Date(t.created_at).toLocaleTimeString('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </span>
                    <div>
                      <p
                        className={`font-mono text-[10px] uppercase tracking-widest mb-2 ${
                          role === 'user'
                            ? 'text-amber/70'
                            : role === 'assistant'
                              ? 'text-cream/55'
                              : 'text-cream/35'
                        }`}
                      >
                        {role === 'tool' && t.tool_name
                          ? `tool · ${t.tool_name}`
                          : role}
                      </p>
                      <pre
                        className={`whitespace-pre-wrap break-words leading-relaxed ${
                          role === 'tool'
                            ? 'font-mono text-[12px] text-cream/55'
                            : 'font-sans text-[14px] text-cream/85'
                        }`}
                      >
                        {body}
                      </pre>
                      {t.files_touched && t.files_touched.length > 0 && (
                        <p className="font-mono text-[10px] text-cream/30 mt-2">
                          {t.files_touched.join(' · ')}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}

function DigestList({
  label,
  items,
  accent,
  mono,
}: {
  label: string;
  items: string[];
  accent: 'amber' | 'cream' | 'rose';
  mono?: boolean;
}) {
  const dotColor =
    accent === 'amber' ? 'bg-amber/70' : accent === 'rose' ? 'bg-rose-400/70' : 'bg-cream/40';
  const labelColor =
    accent === 'amber' ? 'text-amber/70' : accent === 'rose' ? 'text-rose-400/70' : 'text-cream/45';

  return (
    <div>
      <p className={`font-mono text-[10px] uppercase tracking-widest ${labelColor} mb-3`}>
        {label}
      </p>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className={`mt-2 w-[5px] h-[5px] rounded-full flex-shrink-0 ${dotColor}`} />
            <span
              className={`leading-relaxed ${
                mono ? 'font-mono text-[12px] text-cream/65' : 'text-[14px] text-cream/80'
              }`}
            >
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
