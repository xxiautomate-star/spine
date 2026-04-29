import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase, getServerUser, isAuthConfigured } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Sessions — Spine',
  description: 'Every conversation, every turn. Append-only.',
};

type Row = {
  id: string;
  session_id: string;
  kind: 'turn' | 'digest' | null;
  content: string;
  source: string | null;
  created_at: string;
};

type SessionSummary = {
  sessionId: string;
  shortId: string;
  firstSeen: string;
  lastSeen: string;
  turns: number;
  hasDigest: boolean;
  digestPreview: string | null;
  source: string | null;
};

function digestPreview(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const decisions = Array.isArray(parsed.decisions) ? (parsed.decisions as unknown[]) : [];
    const state = typeof parsed.state === 'string' ? parsed.state : '';
    if (decisions.length > 0) {
      const first = String(decisions[0]);
      return first.length > 140 ? first.slice(0, 140) + '…' : first;
    }
    if (state) return state.length > 140 ? state.slice(0, 140) + '…' : state;
    return null;
  } catch {
    return content.length > 140 ? content.slice(0, 140) + '…' : content;
  }
}

function summarise(rows: Row[]): SessionSummary[] {
  const map = new Map<string, SessionSummary>();
  for (const r of rows) {
    if (!r.session_id) continue;
    const cur =
      map.get(r.session_id) ??
      ({
        sessionId: r.session_id,
        shortId: r.session_id.slice(0, 8),
        firstSeen: r.created_at,
        lastSeen: r.created_at,
        turns: 0,
        hasDigest: false,
        digestPreview: null,
        source: r.source,
      } satisfies SessionSummary);
    if (r.created_at < cur.firstSeen) cur.firstSeen = r.created_at;
    if (r.created_at > cur.lastSeen) cur.lastSeen = r.created_at;
    if (r.kind === 'turn') cur.turns += 1;
    if (r.kind === 'digest') {
      cur.hasDigest = true;
      if (!cur.digestPreview) cur.digestPreview = digestPreview(r.content);
    }
    if (!cur.source && r.source) cur.source = r.source;
    map.set(r.session_id, cur);
  }
  return [...map.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

async function fetchSessions(userId: string): Promise<SessionSummary[]> {
  const supabase = await getServerSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from('memories')
    .select('id, session_id, kind, content, source, created_at')
    .eq('user_id', userId)
    .not('session_id', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  return summarise((data ?? []) as Row[]).slice(0, 50);
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
}

export default async function SessionsIndexPage() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');

  const sessions = await fetchSessions(user.id);

  return (
    <main className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      <header className="border-b border-cream/[0.06] px-6 md:px-12 py-8">
        <div className="max-w-5xl mx-auto flex items-baseline justify-between gap-6">
          <div>
            <h1 className="font-serif text-4xl md:text-5xl tracking-tight leading-[0.95]">
              Sessions
            </h1>
            <p className="font-mono text-[11px] uppercase tracking-widest text-cream/35 mt-3">
              Every conversation, every turn. Append-only.
            </p>
          </div>
          <Link
            href="/timeline"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber transition-colors duration-300"
          >
            ← Timeline
          </Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 md:px-12 py-12">
        {sessions.length === 0 ? (
          <div className="py-24 text-center">
            <p className="font-serif text-2xl text-cream/55">No sessions captured yet.</p>
            <p className="font-mono text-[11px] uppercase tracking-widest text-cream/30 mt-4">
              Wire the SessionStart / UserPromptSubmit / Stop hooks
              <br />
              and your next conversation will appear here as it happens.
            </p>
            <Link
              href="/docs/mcp"
              className="inline-block mt-8 font-mono text-[10px] uppercase tracking-widest text-amber/70 hover:text-amber transition-colors duration-300"
            >
              Hook setup docs →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-cream/[0.05]">
            {sessions.map((s) => (
              <li key={s.sessionId}>
                <Link
                  href={`/sessions/${encodeURIComponent(s.sessionId)}`}
                  className="block group py-6 hover:bg-cream/[0.02] -mx-6 px-6 transition-colors duration-300"
                >
                  <div className="flex items-baseline justify-between gap-6 mb-2">
                    <h2 className="font-serif text-2xl text-cream group-hover:text-amber transition-colors duration-500">
                      session {s.shortId}
                    </h2>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-cream/40 flex-shrink-0">
                      {formatRelative(s.lastSeen)}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-cream/40">
                      {s.turns} turn{s.turns === 1 ? '' : 's'}
                    </span>
                    {s.hasDigest && (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-amber/60 flex items-center gap-1.5">
                        <span className="w-[5px] h-[5px] rounded-full bg-amber/70" /> digest
                      </span>
                    )}
                    {s.source && (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30">
                        {s.source}
                      </span>
                    )}
                  </div>
                  {s.digestPreview && (
                    <p className="font-serif text-[15px] text-cream/65 leading-relaxed italic">
                      {s.digestPreview}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
