import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase, getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { formatWeeklyDigestMarkdown, type WeeklyDigestPayload } from '@/lib/weekly-digest';
import { CopyMarkdownButton } from './CopyMarkdownButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Weekly digest — Spine',
  description: 'Every week of your AI work, rolled up.',
};

type Row = {
  id: string;
  content: string;
  created_at: string;
  coverage_window: { start: string; end: string } | null;
  caption: string | null;
};

type Card = {
  id: string;
  week: string;
  payload: WeeklyDigestPayload;
  errored: boolean;
  errorMessage: string | null;
  range: { start: string; end: string } | null;
  generatedAt: string;
  markdown: string;
};

function isoWeekOf(iso: string): string {
  const date = new Date(iso);
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function parsePayload(content: string): WeeklyDigestPayload {
  try {
    const v = JSON.parse(content) as Partial<WeeklyDigestPayload>;
    return {
      themes: Array.isArray(v.themes) ? v.themes.filter((s): s is string => typeof s === 'string') : [],
      decisions: Array.isArray(v.decisions) ? v.decisions.filter((s): s is string => typeof s === 'string') : [],
      open_threads: Array.isArray(v.open_threads) ? v.open_threads.filter((s): s is string => typeof s === 'string') : [],
      commits: Array.isArray(v.commits) ? v.commits.filter((s): s is string => typeof s === 'string') : [],
      session_count: typeof v.session_count === 'number' ? v.session_count : 0,
      generated_at: typeof v.generated_at === 'string' ? v.generated_at : '',
    };
  } catch {
    return { themes: [], decisions: [], open_threads: [], commits: [], session_count: 0, generated_at: '' };
  }
}

function parseError(caption: string | null): string | null {
  if (!caption) return null;
  try {
    const parsed = JSON.parse(caption) as { error?: string };
    return typeof parsed.error === 'string' ? parsed.error : null;
  } catch {
    return null;
  }
}

function rangeLabel(range: { start: string; end: string } | null): string {
  if (!range) return '';
  const start = new Date(range.start);
  const end = new Date(range.end);
  const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-AU', fmt)} – ${end.toLocaleDateString('en-AU', fmt)}`;
}

async function fetchWeeklyRows(userId: string): Promise<Card[]> {
  const supabase = await getServerSupabase();
  if (!supabase) return [];
  const { data } = await supabase
    .from('memories')
    .select('id, content, created_at, coverage_window, caption')
    .eq('user_id', userId)
    .eq('kind', 'weekly_digest')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(40);
  return ((data ?? []) as Row[]).map((r) => {
    const range = r.coverage_window ?? null;
    const week = range ? isoWeekOf(range.start) : isoWeekOf(r.created_at);
    const payload = parsePayload(r.content);
    const errorMessage = parseError(r.caption);
    return {
      id: r.id,
      week,
      payload,
      errored: errorMessage !== null,
      errorMessage,
      range,
      generatedAt: payload.generated_at || r.created_at,
      markdown: formatWeeklyDigestMarkdown(week, payload),
    };
  });
}

export default async function WeeklyDigestIndex() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');

  const cards = await fetchWeeklyRows(user.id);

  return (
    <main className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      <header className="border-b border-cream/[0.06] px-5 sm:px-8 md:px-12 py-8">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/sessions"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber transition-colors duration-300 inline-block mb-5"
          >
            ← Sessions
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl tracking-tight leading-[0.95]">
            Weekly digest
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/35 mt-3">
            Every week of your AI work, rolled up. Append-only.
          </p>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-5 sm:px-8 md:px-12 py-10 md:py-14 space-y-12 md:space-y-16">
        {cards.length === 0 ? (
          <EmptyState />
        ) : (
          cards.map((c) => <WeeklyCard key={c.id} card={c} />)
        )}
      </section>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="py-16 md:py-24 text-center">
      <p className="font-serif text-2xl text-cream/55">No weekly digests yet.</p>
      <p className="font-mono text-[11px] uppercase tracking-widest text-cream/30 mt-4 leading-relaxed">
        Spine writes one weekly rollup per ISO week, automatically — once
        you have at least one
        <br className="hidden sm:block" />
        end-of-session digest captured. Wire the SessionStart / Stop hooks
        and yours appears here next Monday.
      </p>
      <Link
        href="/docs/mcp"
        className="inline-block mt-8 font-mono text-[10px] uppercase tracking-widest text-amber/70 hover:text-amber transition-colors duration-300"
      >
        Hook setup docs →
      </Link>
    </div>
  );
}

function WeeklyCard({ card }: { card: Card }) {
  return (
    <article className="relative border-l-2 border-amber/60 pl-6 sm:pl-8 -ml-2">
      <div
        className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-amber"
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-5">
        <h2 className="font-serif text-2xl sm:text-3xl text-cream">
          week {card.week}
        </h2>
        {card.range && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-cream/40">
            {rangeLabel(card.range)}
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-widest text-cream/40">
          {card.payload.session_count} session{card.payload.session_count === 1 ? '' : 's'}
        </span>
        <CopyMarkdownButton markdown={card.markdown} />
      </div>

      {card.errored ? (
        <p className="font-mono text-[11px] text-rose-400/70 mb-6 leading-relaxed">
          rollup failed: {card.errorMessage ?? 'unknown error'}
        </p>
      ) : null}

      {card.payload.themes.length > 0 && (
        <Section label="Themes">
          <ul className="space-y-2.5">
            {card.payload.themes.map((t, i) => (
              <BulletItem key={i}>{t}</BulletItem>
            ))}
          </ul>
        </Section>
      )}

      {card.payload.decisions.length > 0 && (
        <Section label="Decisions">
          <ul className="space-y-2.5">
            {card.payload.decisions.map((d, i) => (
              <BulletItem key={i} accent="amber">{d}</BulletItem>
            ))}
          </ul>
        </Section>
      )}

      {card.payload.open_threads.length > 0 && (
        <Section label="Open threads">
          <ul className="space-y-2.5">
            {card.payload.open_threads.map((o, i) => (
              <BulletItem key={i}>{o}</BulletItem>
            ))}
          </ul>
        </Section>
      )}

      {card.payload.commits.length > 0 && (
        <Section label="Commits">
          <ul className="space-y-1.5">
            {card.payload.commits.map((c, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-2 w-[5px] h-[5px] rounded-full flex-shrink-0 bg-cream/40" />
                <code className="font-mono text-[12px] text-cream/65 break-words leading-snug">
                  {c}
                </code>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45 mb-3">
        {label}
      </p>
      {children}
    </div>
  );
}

function BulletItem({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: 'amber' | 'cream';
}) {
  const dot = accent === 'amber' ? 'bg-amber/70' : 'bg-cream/40';
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-2 w-[5px] h-[5px] rounded-full flex-shrink-0 ${dot}`} />
      <span className="font-serif text-[15px] sm:text-[16px] text-cream/85 leading-relaxed">
        {children}
      </span>
    </li>
  );
}
