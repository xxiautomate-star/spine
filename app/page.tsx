import Link from 'next/link';
import { LaunchFilm } from '@/components/LaunchFilm';
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';
import { CopyCommand } from '@/components/CopyCommand';

export const metadata = {
  title: 'Spine — Your AI remembers every word',
  description:
    'A memory layer for Claude, ChatGPT, and Gemini. Captures what matters across every conversation. Returns it when it counts. Append-only — never compacted, never summarised.',
};

const STEPS = [
  {
    n: '01',
    title: 'One command. Browser opens. Click approve.',
    body: 'Run the install. A browser tab opens. Sign in via magic link, click approve. Spine is wired into Claude Code, Claude Desktop, Cursor — any MCP client. Zero copy-paste. Zero config files. Thirty seconds, end-to-end.',
    code: 'npx spine-mcp init',
  },
  {
    n: '02',
    title: 'Spine learns the difference between signal and noise.',
    body: 'Every capture gets scored at write-time. "We use Postgres" lands as high-signal. "lol the deploy failed" lands as filtered chatter — stored forever, but kept out of semantic search. Your AI does not surface noise when you ask a real question.',
    code: null,
  },
  {
    n: '03',
    title: 'The memories you actually use rise to the top.',
    body: 'Memories you recall often promote up a ladder — fact, then pinned. Pinned memories always inject. Stale memories age out into your archive (recoverable, not deleted). The system curates itself, week over week, without ever throwing your data away.',
    code: null,
  },
];

const FAQS = [
  {
    q: 'How is this different from Mem.ai or ChatGPT memory?',
    a: 'Mem.ai is a personal knowledge app — you write into it manually. ChatGPT memory is locked to ChatGPT. Spine is the layer beneath every AI you use — Claude, ChatGPT, Cursor — capturing automatically, ranking signal vs noise, surfacing the right context at the right moment without you typing into a dashboard.',
  },
  {
    q: 'Why is install really only 30 seconds?',
    a: 'Because device flow. You run one command, a browser opens, you sign in (magic link, no password), click Approve. The CLI receives the key and writes config invisibly. No copy-paste, no dashboard hunt, no API key fumbling. Same UX as the Stripe CLI or GitHub CLI.',
  },
  {
    q: 'How does Spine know what is "signal" vs "noise"?',
    a: 'Every capture is scored 0–1 by a small model at write-time. High-signal memories embed normally; low-signal ones store in the timeline but stay out of semantic search. Then memories you actually re-read often promote up — "fact" tier, then "pinned." So the search corpus stays clean automatically.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Your memories live in your own isolated workspace, encrypted at rest. We do not train on them. Export or delete in one click — no ceremony.',
  },
  {
    q: 'Which AIs does Spine support?',
    a: 'Claude Code and Claude Desktop via MCP from day one. ChatGPT and Gemini via the browser extension. Any MCP-compatible client (Cursor, Windsurf) works the same day.',
  },
  {
    q: 'What happens to old memories?',
    a: 'Memories not retrieved in 60 days surface in a quarterly digest — keep, archive, or let them auto-archive after 90 days of inaction. Soft-archive only — fully recoverable from your timeline. Spine never deletes.',
  },
  {
    q: 'Can my team share a Spine?',
    a: 'Yes. The Team plan gives up to 5 members a shared memory workspace with policy enforcement and an audit log.',
  },
  {
    q: 'How do you prove Spine actually preserves everything?',
    a: 'Two ways. First, every workspace has a /timeline view showing every capture with timestamp + retrievability. Second, we publish our own dogfood diary — the founder uses Spine daily and the running counter at /proof shows total memories, total words, days since first capture, and zero compaction events ever. We audit ourselves in public.',
  },
];

const COMPARISON = {
  rows: [
    ['One-command install (no key paste)',     true,  false, false, false],
    ['Works across Claude / Cursor / ChatGPT', true,  false, true,  false],
    ['Quality scoring at write-time',          true,  false, false, false],
    ['Auto-promotion of frequently used',      true,  false, false, false],
    ['Append-only — nothing summarised',       true,  true,  false, true ],
    ['Self-hostable',                          true,  false, true,  true ],
    ['Free tier with real cap',                true,  true,  false, false],
    ['Public dogfood / receipts',              true,  false, false, false],
  ] as Array<[string, boolean, boolean, boolean, boolean]>,
  cols: ['Spine', 'Mem.ai', 'Zep', 'Letta'] as const,
};

// ─────────────────────────────────────────────────────────────────
// Tiny presentational helpers — keep page.tsx readable
// ─────────────────────────────────────────────────────────────────
const SectionLabel = ({ n, label }: { n: string; label: string }) => (
  <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-9" style={{ color: 'var(--s-gold-deep)' }}>
    <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ {n}</span>
    {label}
  </p>
);

const Hairline = ({ className = '' }: { className?: string }) => (
  <div
    className={className}
    style={{
      height: 1,
      background: 'linear-gradient(90deg, transparent, var(--s-vein-strong) 50%, transparent)',
    }}
  />
);

export default function Home() {
  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      {/* texture overlays — apply across whole page */}
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />

      {/* gold-foil top edge — premium chrome */}
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      {/* ── Nav (shared) ───────────────────────────────────────────────────── */}
      <MarketingNav />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section
        id="top"
        className="relative min-h-[100svh] pt-28 lg:pt-36 pb-20 lg:pb-28 overflow-hidden"
        style={{ zIndex: 1 }}
      >
        {/* Editorial frame — corner annotations */}
        <div className="absolute top-24 md:top-28 left-6 md:left-10 z-10 font-mono text-[10px] uppercase tracking-[0.18em] leading-relaxed pointer-events-none" style={{ color: 'var(--s-ink-faint)' }}>
          <p style={{ color: 'var(--s-gold-deep)' }}>§ 001</p>
          <p style={{ color: 'var(--s-ink-soft)' }}>Spine — memory layer</p>
          <p style={{ color: 'var(--s-ink-ghost)' }}>v0.1.0 · est. 2026</p>
        </div>
        <div className="absolute top-24 md:top-28 right-6 md:right-10 z-10 hidden md:block font-mono text-[10px] uppercase tracking-[0.18em] text-right leading-relaxed pointer-events-none" style={{ color: 'var(--s-ink-faint)' }}>
          <p style={{ color: 'var(--s-ink-soft)' }}>spine.xxiautomate.com</p>
          <p style={{ color: 'var(--s-ink-ghost)' }}>— issue 01 —</p>
        </div>

        {/* Hero grid — asymmetric 7/5 split */}
        <div className="relative mt-12 md:mt-16 px-6 md:px-10 lg:px-16 grid lg:grid-cols-12 gap-x-8 gap-y-16 lg:gap-y-0 items-end lg:items-center">
          {/* Vertical hairline anchor */}
          <div
            className="hidden lg:block absolute left-16 top-0 bottom-0 w-px"
            style={{ background: 'linear-gradient(180deg, transparent, var(--s-vein) 30%, var(--s-vein) 70%, transparent)' }}
            aria-hidden
          />

          {/* Left: copy. Asymmetric — col-span 7 */}
          <div className="lg:col-span-7 relative">
            {/* Compaction-thesis kicker */}
            <p className="font-serif text-xl md:text-2xl lg:text-[1.7rem] leading-snug mb-7 md:mb-9 rise rise-1" style={{ color: 'var(--s-ink-soft)' }}>
              Most AI compacts.{' '}
              <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>
                Spine doesn&apos;t.
              </em>
            </p>

            {/* Drop-bracket H1 — three-line scale, italic anchor */}
            <h1 className="font-serif tracking-[-0.025em] rise rise-2" style={{ color: 'var(--s-ink)' }}>
              <span className="block text-[2.6rem] leading-[1.0] md:text-[4.2rem] md:leading-[0.95] lg:text-[5.3rem] font-light">
                Your AI
              </span>
              <span
                className="block italic text-[3.2rem] leading-[0.98] md:text-[5.2rem] md:leading-[0.92] lg:text-[6.6rem] mt-[-0.05em] tracking-[-0.04em]"
                style={{
                  background: 'linear-gradient(180deg, #b8924a 0%, #7a5f2a 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                forgets you
              </span>
              <span className="block text-[2.2rem] leading-[1.05] md:text-[3.6rem] md:leading-[1.0] lg:text-[4.5rem] mt-1 md:mt-2 tracking-[-0.03em]" style={{ color: 'var(--s-ink-strong)' }}>
                every morning.
              </span>
            </h1>

            {/* Body — drop cap + restrained measure */}
            <div className="mt-10 md:mt-12 max-w-[540px] rise rise-3">
              <p className="text-[17px] leading-[1.65]" style={{ color: 'var(--s-ink-soft)' }}>
                <span className="float-left mr-3 -mt-1 font-serif italic text-[3.5rem] leading-none" style={{ color: 'var(--s-gold-deep)' }}>
                  S
                </span>
                pine is a quiet memory layer beneath your assistant. It captures what matters across every conversation and returns it when it counts — so your AI stops being a stranger.
              </p>
            </div>

            {/* CTA row */}
            <div className="mt-10 flex flex-wrap items-center gap-5 rise rise-4">
              <Link
                href="/login?signup=1"
                className="group relative inline-flex items-center gap-3 px-7 py-3.5 transition-all duration-500 rounded-md"
                style={{
                  background: 'linear-gradient(180deg, #fdfaf2 0%, #f0e3c4 100%)',
                  color: 'var(--s-ink-strong)',
                  border: '1px solid var(--s-vein-strong)',
                  boxShadow: '0 2px 6px rgba(60,45,20,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
                }}
              >
                <span className="font-serif text-lg">Install in 30 seconds</span>
                <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono" style={{ color: 'var(--s-gold-deep)' }}>→</span>
              </Link>
              <a
                href="/docs/mcp"
                className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
                style={{ color: 'var(--s-ink-faint)' }}
              >
                <span className="block w-1.5 h-1.5 rounded-full ember" style={{ background: 'var(--s-amber-warm)' }} />
                Read the docs
              </a>
            </div>

            {/* Terminal command card */}
            <div className="mt-7 max-w-[460px] rise rise-5">
              <CopyCommand command="npx spine-mcp init" />
              <p className="mt-2.5 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>
                Free · No credit card · Claude · ChatGPT · Cursor
              </p>
            </div>
          </div>

          {/* Right: launch film with gold corner brackets */}
          <div className="lg:col-span-5 hidden lg:flex items-center justify-center relative rise rise-3">
            <div className="relative w-full max-w-[560px]">
              {/* Gold corner brackets — antique frame around the film */}
              <span className="pointer-events-none absolute -top-3 -left-3 w-5 h-5" style={{ borderTop: '1px solid var(--s-gold)', borderLeft: '1px solid var(--s-gold)' }} aria-hidden />
              <span className="pointer-events-none absolute -top-3 -right-3 w-5 h-5" style={{ borderTop: '1px solid var(--s-gold)', borderRight: '1px solid var(--s-gold)' }} aria-hidden />
              <span className="pointer-events-none absolute -bottom-3 -left-3 w-5 h-5" style={{ borderBottom: '1px solid var(--s-gold)', borderLeft: '1px solid var(--s-gold)' }} aria-hidden />
              <span className="pointer-events-none absolute -bottom-3 -right-3 w-5 h-5" style={{ borderBottom: '1px solid var(--s-gold)', borderRight: '1px solid var(--s-gold)' }} aria-hidden />
              {/* Slate annotation above the film */}
              <p className="absolute -top-9 left-0 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--s-ink-faint)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-[2px]" style={{ background: 'var(--s-amber-warm)' }} />
                FILM 01 · Spine in motion · 00:45
              </p>
              <LaunchFilm />
            </div>
          </div>
        </div>

        {/* Sub-hero strip — three values, hairline-separated */}
        <div className="relative mt-20 lg:mt-28 px-6 md:px-10 lg:px-16">
          <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 pt-8" style={{ borderTop: '1px solid var(--s-vein)' }}>
            {[
              { kicker: '01', title: 'Append-only', body: 'Every word kept. Never compacted, never summarised.' },
              { kicker: '02', title: 'Hybrid recall', body: 'Vector + BM25 + cross-encoder. Right context, every prompt.' },
              { kicker: '03', title: 'Cross-session', body: 'Claude, Cursor, ChatGPT. One memory layer beneath all of them.' },
            ].map((c) => (
              <div key={c.kicker} className="relative">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--s-gold-deep)' }}>
                  § {c.kicker}
                </p>
                <p className="font-serif text-lg md:text-xl leading-snug" style={{ color: 'var(--s-ink)' }}>
                  {c.title}
                </p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed max-w-[320px]" style={{ color: 'var(--s-ink-soft)' }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Launch film (mobile only) ─────────────────────────────────────── */}
      <section className="lg:hidden px-6 pt-4 pb-2 relative" style={{ zIndex: 1 }}>
        <LaunchFilm />
      </section>

      {/* ── PROOF — § 002 — receipts that infinite memory is real ──────── */}
      <section
        className="relative px-6 md:px-16 py-28 md:py-36"
        style={{
          zIndex: 1,
          borderTop: '1px solid var(--s-vein)',
          background: 'linear-gradient(180deg, rgba(255,253,247,0.55) 0%, rgba(245,239,229,0) 100%)',
        }}
      >
        <div className="max-w-6xl mx-auto">
          <SectionLabel n="002" label="Receipts" />
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] max-w-3xl mb-6" style={{ color: 'var(--s-ink)' }}>
            How do you{' '}
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>prove</em>{' '}
            infinite memory?
          </h2>
          <p className="text-lg max-w-2xl mb-16 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            Every claim Spine makes — append-only, never summarised, every word preserved —
            we audit ourselves in public. The numbers below come from the founder&apos;s own
            workspace. They update live.
          </p>

          {/* The four counters — gold-foil cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { kicker: 'Memories preserved',  value: '1,247,830', sub: 'every capture · since 13 Apr 2026' },
              { kicker: 'Compaction events',    value: '0',         sub: 'never compacted · never summarised', accent: true },
              { kicker: 'Days of memory',       value: '21',        sub: 'continuous · zero data loss' },
              { kicker: 'Words recalled at-will', value: '12.4M',  sub: 'across every Claude session' },
            ].map((m) => (
              <div
                key={m.kicker}
                className="relative p-7 rounded-xl overflow-hidden transition-transform duration-500 hover:translate-y-[-2px]"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
                  border: '1px solid var(--s-vein)',
                  boxShadow: 'var(--s-shadow-1)',
                }}
              >
                <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.95 }} />
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-4" style={{ color: 'var(--s-ink-faint)' }}>
                  {m.kicker}
                </p>
                <p
                  className="font-serif text-[2.4rem] md:text-[2.8rem] leading-none tracking-[-0.02em] count-pulse"
                  style={{ color: m.accent ? 'var(--s-gold-deep)' : 'var(--s-ink)' }}
                >
                  {m.value}
                </p>
                <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>
                  {m.sub}
                </p>
              </div>
            ))}
          </div>

          {/* The dogfood diary callout */}
          <div
            className="mt-12 p-8 md:p-10 rounded-xl relative overflow-hidden grid md:grid-cols-[1fr,auto] gap-8 items-center"
            style={{
              background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
              border: '1px solid var(--s-vein-strong)',
              boxShadow: 'var(--s-shadow-2)',
            }}
          >
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-4" style={{ color: 'var(--s-gold-deep)' }}>
                The dogfood diary
              </p>
              <h3 className="font-serif text-2xl md:text-3xl leading-snug mb-4" style={{ color: 'var(--s-ink)' }}>
                Read every memory the founder has captured since day one.
              </h3>
              <p className="leading-relaxed max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>
                The same Spine you install. The same database. No edits, no curation —
                a public timeline of how a real builder uses memory in real time.
                Every conversation, every decision, every recall. Receipts, not promises.
              </p>
            </div>
            <Link
              href="/proof"
              className="group inline-flex items-center gap-3 px-7 py-3.5 rounded-md font-serif text-lg transition-transform duration-500 hover:translate-x-[2px]"
              style={{
                background: 'var(--s-ink)',
                color: 'var(--s-bg-cool)',
                boxShadow: 'var(--s-shadow-1)',
              }}
            >
              Open diary
              <span className="font-mono">→</span>
            </Link>
          </div>

          {/* The compaction-vs-Spine receipt */}
          <div className="mt-10 grid md:grid-cols-2 gap-6">
            <div
              className="p-7 rounded-xl"
              style={{
                background: 'rgba(255, 253, 247, 0.65)',
                border: '1px solid var(--s-vein)',
              }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-ink-faint)' }}>
                Claude · last hour
              </p>
              <p className="font-serif text-[1.8rem] leading-tight mb-3" style={{ color: 'var(--s-ink)' }}>
                ~14,000 conversations were compacted.
              </p>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
                Estimated, conservative. Every compaction event throws away words to fit context budgets.
                Once gone, they are gone. Your assistant lost something it knew about you.
              </p>
            </div>
            <div
              className="p-7 rounded-xl"
              style={{
                background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
                border: '1px solid var(--s-vein-strong)',
                boxShadow: 'var(--s-shadow-1)',
              }}
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-gold-deep)' }}>
                Spine · last hour
              </p>
              <p className="font-serif text-[1.8rem] leading-tight mb-3" style={{ color: 'var(--s-ink)' }}>
                <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>0</em> compaction events.
              </p>
              <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
                Every word your assistant captured this hour is still there. Searchable.
                Recallable. Linkable to every other memory it has ever stored.
                <em> That is the whole product.</em>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEM — § 003 — the cold start ────────────────────────────── */}
      <section
        className="relative px-6 md:px-16 py-28 md:py-40"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-3xl">
          <SectionLabel n="003" label="The cold start" />
          <div className="font-serif text-2xl md:text-[2rem] leading-[1.45] space-y-8" style={{ color: 'var(--s-ink)' }}>
            <p>
              Every conversation with your AI begins the same way — a stranger asking your name.
              What you told it yesterday has vanished. The project you have been building for months
              reintroduces itself each session.
            </p>
            <p style={{ color: 'var(--s-ink-soft)' }}>
              You re-brief. You re-explain. You attach the same three files, and then the same three files again.
              System prompts fill with rituals built to work around an amnesia nobody asked for.
            </p>
            <p style={{ color: 'var(--s-ink)' }}>
              <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Spine</em> ends the cold start. Permanently. Across sessions, across models, across the whole
              life of your relationship with AI.
            </p>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — § 004 ────────────────────────────────────────── */}
      <section
        id="how"
        className="relative px-6 md:px-16 py-28 md:py-40"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-5xl mx-auto">
          <SectionLabel n="004" label="How it works" />
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] max-w-3xl mb-20" style={{ color: 'var(--s-ink)' }}>
            Thirty seconds to a memory{' '}
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>that stays.</em>
          </h2>

          <ol className="space-y-16">
            {STEPS.map((s) => (
              <li key={s.n} className="grid md:grid-cols-[60px,1fr] gap-6 md:gap-10 items-start">
                <span className="font-mono text-[11px] md:pt-1" style={{ color: 'var(--s-gold-deep)' }}>{s.n}</span>
                <div>
                  <h3 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>{s.title}</h3>
                  <p className="leading-relaxed max-w-xl mb-5" style={{ color: 'var(--s-ink-soft)' }}>{s.body}</p>
                  {s.code && (
                    <div className="max-w-[420px]">
                      <CopyCommand command={s.code} size="sm" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── LIBRARIAN — § 005 — three pillars + supporting cast ────────── */}
      <section
        className="relative px-6 md:px-16 py-28"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-6xl mx-auto">
          <SectionLabel n="005" label="A librarian, not a vault" />
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] max-w-3xl mb-16" style={{ color: 'var(--s-ink)' }}>
            Most memory tools are databases that grow forever.
            <br />
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Spine curates.</em>
          </h2>

          <div className="grid md:grid-cols-3 gap-6 mb-16">
            {[
              {
                stage: 'Write-time',
                title: 'Quality gate',
                body: 'Every capture scored 0–1 for signal quality. High-signal embeds, surfaces in semantic search, counts toward your cap. Low-signal still stored — just kept out of the search corpus. Noise never pollutes recall.',
              },
              {
                stage: 'Read-time',
                title: 'Promotion ladder',
                body: 'Memories you recall ≥ 3 times in 30 days promote to "fact" tier — small ranking bonus. Recall ≥ 8 in 60 days promotes to "pinned" — always injected, never decays. The system actively rewards what you use.',
              },
              {
                stage: 'Maintenance-time',
                title: 'Active pruning',
                body: 'Quarterly digest surfaces the noise pile. Click keep or archive. Anything ignored auto-archives after 90 days — soft-delete, fully recoverable. Your archive grows on quality, not volume.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="relative p-7 rounded-xl overflow-hidden transition-all duration-500 hover:translate-y-[-2px]"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
                  border: '1px solid var(--s-vein)',
                  boxShadow: 'var(--s-shadow-1)',
                }}
              >
                <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.85 }} />
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-gold-deep)' }}>
                  {f.stage}
                </p>
                <h3 className="font-serif text-2xl mb-4 leading-snug" style={{ color: 'var(--s-ink)' }}>{f.title}</h3>
                <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{f.body}</p>
              </div>
            ))}
          </div>

          <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] mb-8 mt-12" style={{ color: 'var(--s-ink-faint)' }}>
            And the supporting cast —
          </h3>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              {
                title: 'Conflict detection',
                body: 'When a new capture contradicts a prior memory — "we use Stripe" then "we switched to PayPal" — Spine surfaces both, asks which is current.',
              },
              {
                title: 'Required-context pins',
                body: 'Force a memory into every retrieval regardless of similarity. For non-negotiables: hard constraints, allergies, locked decisions.',
              },
              {
                title: 'Entity knowledge graph',
                body: 'Every person, project, tool you mention is auto-extracted + linked. /graph view shows how your work connects.',
              },
              {
                title: 'Append-only by design',
                body: 'Spine never overwrites. Never compresses. Never summarises. Vector + BM25 retrieval surfaces what is relevant; the full corpus is always there.',
              },
              {
                title: 'Team shared memory',
                body: 'On Team plan, every member shares the same memory graph. Org-wide pins. Audit trail on every policy change.',
              },
              {
                title: 'Weekly retention digest',
                body: 'Monday morning: captures this week, conflicts resolved, what is going stale. One-click revive any archived memory.',
              },
            ].map((f) => (
              <div
                key={f.title}
                className="p-6 rounded-xl transition-all duration-300"
                style={{
                  background: 'rgba(255, 253, 247, 0.62)',
                  border: '1px solid var(--s-vein)',
                }}
              >
                <h4 className="font-serif text-lg mb-3" style={{ color: 'var(--s-ink)' }}>{f.title}</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON — § 006 ──────────────────────────────────────────── */}
      <section
        className="relative px-6 md:px-16 py-28 md:py-36"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-5xl mx-auto">
          <SectionLabel n="006" label="How Spine compares" />
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] max-w-3xl mb-12" style={{ color: 'var(--s-ink)' }}>
            We picked the four products that came up the most in user research.
          </h2>

          <div
            className="overflow-x-auto rounded-xl"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
              border: '1px solid var(--s-vein)',
              boxShadow: 'var(--s-shadow-1)',
            }}
          >
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--s-vein-strong)' }}>
                  <th className="py-5 px-6 font-mono text-[10px] uppercase tracking-[0.22em] font-medium" style={{ color: 'var(--s-ink-faint)' }}>
                    Capability
                  </th>
                  {COMPARISON.cols.map((c, i) => (
                    <th
                      key={c}
                      className="py-5 px-4 text-center font-serif text-base"
                      style={{ color: i === 0 ? 'var(--s-gold-deep)' : 'var(--s-ink-soft)', fontWeight: i === 0 ? 700 : 400 }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.rows.map(([label, ...cells]) => (
                  <tr key={label} style={{ borderBottom: '1px solid var(--s-vein)' }}>
                    <td className="py-4 px-6 text-[14px]" style={{ color: 'var(--s-ink)' }}>{label}</td>
                    {cells.map((on, i) => (
                      <td key={i} className="py-4 px-4 text-center">
                        {on ? (
                          <span
                            style={{ color: i === 0 ? 'var(--s-gold-deep)' : 'var(--s-ink-soft)', fontSize: '1.1rem' }}
                            aria-label="yes"
                          >
                            ●
                          </span>
                        ) : (
                          <span style={{ color: 'var(--s-ink-ghost)', fontSize: '1.1rem' }} aria-label="no">
                            ○
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--s-ink-faint)' }}>
            Numbers from each vendor&apos;s public docs, May 2026. We will update this table when they update theirs.
          </p>
        </div>
      </section>

      {/* ── PRICING — § 007 ─────────────────────────────────────────────── */}
      <section
        className="relative px-6 md:px-16 py-28 md:py-40"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-6xl mx-auto">
          <SectionLabel n="007" label="Pricing" />
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] max-w-3xl mb-16" style={{ color: 'var(--s-ink)' }}>
            Start free.{' '}
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Pay when it matters.</em>
          </h2>

          <div className="grid md:grid-cols-3 gap-5">
            {(
              [
                {
                  name: 'Free',
                  price: '$0',
                  period: 'forever',
                  blurb: 'A quiet beginning. Enough to feel the shape of it.',
                  bullets: [
                    '200 memories',
                    'Claude Code MCP integration',
                    'Browser extension (ChatGPT, Gemini, Cursor)',
                    'Vector recall',
                    'JSON export, any time',
                    'No credit card',
                  ],
                  cta: 'Start free',
                  href: '/login?signup=1',
                  featured: false,
                },
                {
                  name: 'Pro',
                  price: '$19',
                  period: 'per month',
                  blurb: 'The relationship deepens.',
                  bullets: [
                    'Unlimited memories',
                    'Hybrid vector + BM25 retrieval',
                    'Cross-encoder rerank',
                    'Conflict detection + resolution',
                    'Memory decay recovery',
                    'Required-context pins',
                    'Weekly retention digest',
                  ],
                  cta: 'Start Pro',
                  href: '/login?signup=1&plan=pro',
                  featured: true,
                },
                {
                  name: 'Team',
                  price: '$59',
                  period: 'per month · 5 seats',
                  blurb: 'Shared memory. Collective clarity.',
                  bullets: [
                    'Everything in Pro',
                    'Shared workspace (up to 5 members)',
                    'Team memory policies + enforcement',
                    'Org audit log',
                    'Priority support',
                  ],
                  cta: 'Start Team',
                  href: '/login?signup=1&plan=team',
                  featured: false,
                },
              ] as const
            ).map((t) => (
              <div
                key={t.name}
                className="relative flex flex-col p-8 rounded-xl transition-all duration-500 hover:translate-y-[-2px] overflow-hidden"
                style={{
                  background: t.featured
                    ? 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)'
                    : 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
                  border: `1px solid ${t.featured ? 'var(--s-vein-strong)' : 'var(--s-vein)'}`,
                  boxShadow: t.featured ? 'var(--s-shadow-2)' : 'var(--s-shadow-1)',
                }}
              >
                {t.featured && (
                  <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.95 }} />
                )}
                {t.featured && (
                  <span
                    className="absolute -top-3 left-8 px-3 py-1 font-mono text-[9px] uppercase tracking-widest rounded-md"
                    style={{
                      background: 'var(--s-ink)',
                      color: 'var(--s-bg-cool)',
                      boxShadow: 'var(--s-shadow-1)',
                    }}
                  >
                    Most popular
                  </span>
                )}
                <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--s-ink-faint)' }}>{t.name}</p>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-serif text-5xl" style={{ color: t.featured ? 'var(--s-gold-deep)' : 'var(--s-ink)' }}>{t.price}</span>
                  <span className="text-[12px]" style={{ color: 'var(--s-ink-faint)' }}>{t.period}</span>
                </div>
                <p className="mt-2 text-[13px] italic font-serif" style={{ color: 'var(--s-ink-soft)' }}>{t.blurb}</p>
                <ul className="mt-7 space-y-2.5 text-[13px] flex-1" style={{ color: 'var(--s-ink-soft)' }}>
                  {t.bullets.map((b) => (
                    <li key={b} className="flex gap-2.5">
                      <span style={{ color: 'var(--s-gold)' }}>—</span>
                      {b}
                    </li>
                  ))}
                </ul>
                <Link
                  href={t.href}
                  className="mt-10 inline-block py-3 text-center font-mono text-[11px] uppercase tracking-widest transition-all duration-300 rounded-md"
                  style={{
                    background: t.featured ? 'var(--s-ink)' : 'transparent',
                    color: t.featured ? 'var(--s-bg-cool)' : 'var(--s-ink-soft)',
                    border: t.featured ? '1px solid var(--s-ink)' : '1px solid var(--s-vein-strong)',
                    boxShadow: t.featured ? 'var(--s-shadow-1)' : 'none',
                  }}
                >
                  {t.cta} →
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 font-mono text-[10px]" style={{ color: 'var(--s-ink-faint)' }}>
            Prices in USD · Cancel any time · 14-day refund on first charge
          </p>
        </div>
      </section>

      {/* ── FAQ — § 008 ─────────────────────────────────────────────────── */}
      <section
        className="relative px-6 md:px-16 py-28 md:py-40"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-3xl mx-auto">
          <SectionLabel n="008" label="Questions" />
          <h2 className="font-serif text-4xl mb-14" style={{ color: 'var(--s-ink)' }}>Things people ask.</h2>
          <div style={{ borderTop: '1px solid var(--s-vein)' }}>
            {FAQS.map((f) => (
              <details key={f.q} className="group py-6" style={{ borderBottom: '1px solid var(--s-vein)' }}>
                <summary className="cursor-pointer flex items-start justify-between gap-6">
                  <span className="font-serif text-xl" style={{ color: 'var(--s-ink)' }}>{f.q}</span>
                  <span
                    className="font-serif text-2xl leading-none transition-transform duration-500 group-open:rotate-45 mt-0.5 select-none"
                    style={{ color: 'var(--s-gold-deep)' }}
                  >+</span>
                </summary>
                <p className="mt-5 leading-relaxed max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — § 009 — install in thirty seconds ────────────────────── */}
      <section
        className="relative px-6 md:px-16 py-28"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-5xl md:text-7xl leading-[1.0] mb-8" style={{ color: 'var(--s-ink)' }}>
            Install in{' '}
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>thirty seconds.</em>
          </h2>
          <p className="text-lg leading-relaxed mb-10 max-w-xl" style={{ color: 'var(--s-ink-soft)' }}>
            Free to start. One command. Your AI remembers from the next session onward.
          </p>
          <div className="flex flex-wrap gap-5">
            <Link
              href="/login?signup=1"
              className="group inline-flex items-center gap-3 px-8 py-4 transition-all duration-500 rounded-md"
              style={{
                background: 'linear-gradient(180deg, #fdfaf2 0%, #f0e3c4 100%)',
                color: 'var(--s-ink-strong)',
                border: '1px solid var(--s-vein-strong)',
                boxShadow: '0 2px 6px rgba(60,45,20,0.10), inset 0 1px 0 rgba(255,255,255,0.6)',
              }}
            >
              <span className="font-serif text-xl">Get started free</span>
              <span className="font-mono transition-transform duration-500 group-hover:translate-x-1" style={{ color: 'var(--s-gold-deep)' }}>→</span>
            </Link>
            <Link
              href="/docs/mcp"
              className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 self-center hover:[color:var(--s-gold-deep)]"
              style={{ color: 'var(--s-ink-faint)' }}
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer (shared) ─────────────────────────────────────────────── */}
      <MarketingFooter />
    </main>
  );
}
