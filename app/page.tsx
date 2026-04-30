import Link from 'next/link';
import { LaunchFilm } from '@/components/LaunchFilm';

export const metadata = {
  title: 'Spine — Your AI remembers every word',
  description: 'A memory layer for Claude, ChatGPT, and Gemini. Captures what matters across every conversation. Returns it when it counts.',
};

const STEPS = [
  {
    n: '01',
    title: 'One command. Browser opens. Click approve.',
    body: 'Run the install. A browser tab opens. Sign in via magic link, click approve. Spine is wired into Claude Code, Claude Desktop, Cursor — any MCP client. Zero copy-paste. Zero config files. Thirty seconds, end-to-end.',
    code: 'npx @spine/mcp init',
  },
  {
    n: '02',
    title: 'Spine learns the difference between signal and noise.',
    body: "Every capture gets scored at write-time. \"We use Postgres\" lands as high-signal. \"lol the deploy failed\" lands as filtered chatter — stored forever, but kept out of semantic search. Your AI doesn't surface noise when you ask a real question.",
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
  ] as Array<[string, boolean, boolean, boolean, boolean]>,
  cols: ['Spine', 'Mem.ai', 'Zep', 'Letta'] as const,
};

export default function Home() {
  return (
    <main className="relative bg-[#0D0C0A] text-[#E8E4DD] overflow-x-hidden">
      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-[#0D0C0A]/70 border-b border-[#E8E4DD]/[0.05]">
        <a href="#top" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-[#E89A3C] ember" aria-hidden />
          <span className="font-serif text-xl tracking-wide">Spine</span>
        </a>
        <div className="flex items-center gap-4 md:gap-6">
          <a href="/features" className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/40 hover:text-[#E89A3C] transition-colors duration-300 hidden md:block">
            Features
          </a>
          <a href="/pricing" className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/40 hover:text-[#E89A3C] transition-colors duration-300 hidden md:block">
            Pricing
          </a>
          <a href="/docs/mcp" className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/40 hover:text-[#E89A3C] transition-colors duration-300 hidden md:block">
            Docs
          </a>
          <Link
            href="/login"
            className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/50 hover:text-[#E8E4DD] transition-colors duration-300"
          >
            Sign in
          </Link>
          <Link
            href="/login?signup=1"
            className="font-mono text-[10px] uppercase tracking-widest px-4 py-2 bg-[#E89A3C] text-[#0D0C0A] hover:bg-[#E8E4DD] transition-colors duration-300"
          >
            Install free →
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section id="top" className="relative min-h-[100svh] grid lg:grid-cols-[1fr,1fr] items-center pt-20">
        {/* Atmosphere */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute top-1/4 left-[10%] w-[500px] h-[500px] rounded-full bg-[#E89A3C]/[0.07] blur-[180px]" />
          <div className="absolute bottom-0 right-[5%] w-[400px] h-[300px] rounded-full bg-[#4A5E7A]/[0.08] blur-[160px]" />
        </div>

        {/* Left: copy */}
        <div className="relative px-6 md:px-16 py-20 lg:py-0 max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-8 animate-[fadeUp_0.6s_0.1s_both]">
            § 001 · Spine · Memory layer for AI
          </p>
          <h1 className="font-serif text-[2.8rem] leading-[1.0] md:text-[4.5rem] md:leading-[0.98] lg:text-[5.5rem] text-[#E8E4DD] tracking-tight animate-[fadeUp_0.7s_0.2s_both]">
            Your AI{' '}
            <em className="italic text-[#E89A3C]">forgets you</em>
            <br />
            every morning.
          </h1>
          <p className="mt-8 text-lg text-[#E8E4DD]/60 leading-relaxed max-w-lg animate-[fadeUp_0.7s_0.35s_both]">
            Spine is a quiet memory layer beneath your assistant. It captures what matters across every
            conversation and returns it when it counts — so your AI stops being a stranger.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-5 animate-[fadeUp_0.7s_0.5s_both]">
            <Link
              href="/login?signup=1"
              className="group inline-flex items-center gap-3 px-7 py-3.5 bg-[#E89A3C] text-[#0D0C0A] hover:bg-[#E8E4DD] transition-colors duration-500"
            >
              <span className="font-serif text-lg">Install in 30 seconds</span>
              <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono">→</span>
            </Link>
            <a
              href="/docs/mcp"
              className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#E8E4DD]/50 hover:text-[#E89A3C] transition-colors duration-300"
            >
              <span className="block w-1.5 h-1.5 rounded-full bg-[#E89A3C]" />
              Read the docs
            </a>
          </div>

          <p className="mt-10 font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/25 animate-[fadeUp_0.7s_0.6s_both]">
            Free plan · No credit card · Claude · ChatGPT · Gemini · Cursor
          </p>
        </div>

        {/* Right: launch film — replaces the old InstallDemoLoop demo.
            On mobile (lg breakpoint) the film moves below the copy via
            its own section, so the hero still fits one viewport. */}
        <div className="relative hidden lg:flex items-center justify-center pr-12 py-16">
          <LaunchFilm />
        </div>
      </section>

      {/* ── Launch film (mobile only — lg+ shows it inside the hero) ─────── */}
      <section className="lg:hidden px-6 pt-4 pb-2">
        <LaunchFilm />
      </section>

      {/* ── Problem statement ─────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 002 · The cold start
          </p>
          <div className="font-serif text-2xl md:text-[2rem] leading-[1.45] text-[#E8E4DD]/90 space-y-8">
            <p>
              Every conversation with your AI begins the same way — a stranger asking your name.
              What you told it yesterday has vanished. The project you have been building for months
              reintroduces itself each session.
            </p>
            <p className="text-[#E8E4DD]/55">
              You re-brief. You re-explain. You attach the same three files, and then the same three files again.
              System prompts fill with rituals built to work around an amnesia nobody asked for.
            </p>
            <p className="text-[#E8E4DD]">
              Spine ends the cold start. Permanently. Across sessions, across models, across the whole
              life of your relationship with AI.
            </p>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" className="px-6 md:px-16 py-28 md:py-40 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-5xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 003 · How it works
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-[#E8E4DD] max-w-3xl mb-20">
            Thirty seconds to a memory that stays.
          </h2>

          <ol className="space-y-16">
            {STEPS.map((s) => (
              <li key={s.n} className="grid md:grid-cols-[60px,1fr] gap-6 md:gap-10 items-start">
                <span className="font-mono text-[11px] text-[#E8E4DD]/30 md:pt-1">{s.n}</span>
                <div>
                  <h3 className="font-serif text-2xl md:text-3xl text-[#E8E4DD] mb-4">{s.title}</h3>
                  <p className="text-[#E8E4DD]/65 leading-relaxed max-w-xl mb-5">{s.body}</p>
                  {s.code && (
                    <div className="inline-flex items-center gap-3 px-4 py-2.5 bg-[#E89A3C]/[0.06] border border-[#E89A3C]/20 rounded-lg">
                      <span className="text-[#E8E4DD]/30 font-mono text-[12px] select-none">$</span>
                      <code className="font-mono text-[13px] text-[#E89A3C]/80">{s.code}</code>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The lifecycle — three pillars ─────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-6xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 004 · A librarian, not a vault
          </p>
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] text-[#E8E4DD] max-w-3xl mb-16">
            Most memory tools are databases that grow forever.
            <br />
            <em className="italic text-[#E89A3C]">Spine curates.</em>
          </h2>

          <div className="grid md:grid-cols-3 gap-6 mb-12">
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
              <div key={f.title} className="p-7 border border-[#E89A3C]/[0.18] rounded-xl bg-[#E89A3C]/[0.025] hover:bg-[#E89A3C]/[0.04] transition-colors duration-300">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/70 mb-3">
                  {f.stage}
                </p>
                <h3 className="font-serif text-2xl text-[#E8E4DD] mb-4 leading-snug">{f.title}</h3>
                <p className="text-[#E8E4DD]/55 text-[13.5px] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>

          <h3 className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/35 mb-8 mt-20">
            And the supporting cast —
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
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
              <div key={f.title} className="p-6 border border-[#E8E4DD]/[0.07] rounded-xl hover:border-[#E8E4DD]/[0.15] transition-colors duration-300">
                <h4 className="font-serif text-lg text-[#E8E4DD]/90 mb-3">{f.title}</h4>
                <p className="text-[#E8E4DD]/45 text-[13px] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison table ──────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 md:py-36 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-5xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 005 · How Spine compares
          </p>
          <h2 className="font-serif text-4xl md:text-5xl leading-[1.1] text-[#E8E4DD] max-w-3xl mb-12">
            We picked the four products that came up the most in user research.
          </h2>

          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left border-collapse min-w-[640px]">
              <thead>
                <tr className="border-b border-[#E8E4DD]/[0.12]">
                  <th className="py-4 pr-4 font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/40 font-medium">
                    Capability
                  </th>
                  {COMPARISON.cols.map((c, i) => (
                    <th
                      key={c}
                      className={`py-4 px-4 text-center font-serif text-base ${
                        i === 0 ? 'text-[#E89A3C]' : 'text-[#E8E4DD]/55'
                      }`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.rows.map(([label, ...cells]) => (
                  <tr key={label} className="border-b border-[#E8E4DD]/[0.06]">
                    <td className="py-4 pr-4 text-[#E8E4DD]/75 text-[14px]">{label}</td>
                    {cells.map((on, i) => (
                      <td key={i} className="py-4 px-4 text-center">
                        {on ? (
                          <span
                            className={i === 0 ? 'text-[#E89A3C]' : 'text-[#E8E4DD]/65'}
                            aria-label="yes"
                          >
                            ●
                          </span>
                        ) : (
                          <span className="text-[#E8E4DD]/15" aria-label="no">
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

          <p className="mt-10 font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/30">
            Numbers from each vendor's public docs, October 2026. We will update this table when they update theirs.
          </p>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-6xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 006 · Pricing
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-[#E8E4DD] max-w-3xl mb-16">
            Start free. Pay when it matters.
          </h2>

          <div className="grid md:grid-cols-3 gap-5">
            {(
              [
                {
                  name: 'Free',
                  price: '$0',
                  period: 'forever',
                  blurb: 'A quiet beginning.',
                  bullets: ['200 memories', 'Claude Code MCP', 'Browser extension', 'Export any time'],
                  cta: 'Start free',
                  href: '/login?signup=1',
                  featured: false,
                },
                {
                  name: 'Pro',
                  price: '$19',
                  period: 'per month',
                  blurb: 'The relationship deepens.',
                  bullets: ['Unlimited memories', 'Conflict detection', 'Memory decay recovery', 'Required-context pins', 'Weekly digest'],
                  cta: 'Start Pro',
                  href: '/login?signup=1&plan=pro',
                  featured: true,
                },
                {
                  name: 'Team',
                  price: '$59',
                  period: 'per month · 5 seats',
                  blurb: 'Shared memory. Collective clarity.',
                  bullets: ['Everything in Pro', 'Shared workspace', 'Team memory policies', 'Org audit log', 'Priority support'],
                  cta: 'Start Team',
                  href: '/login?signup=1&plan=team',
                  featured: false,
                },
              ] as const
            ).map((t) => (
              <div
                key={t.name}
                className={`relative flex flex-col p-8 border transition-colors duration-500 ${
                  t.featured
                    ? 'border-[#E89A3C]/40 bg-[#E89A3C]/[0.03]'
                    : 'border-[#E8E4DD]/[0.08] hover:border-[#E8E4DD]/20'
                }`}
              >
                {t.featured && (
                  <span className="absolute -top-3 left-8 px-2 py-0.5 bg-[#E89A3C] text-[#0D0C0A] font-mono text-[9px] uppercase tracking-widest">
                    Most popular
                  </span>
                )}
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/40">{t.name}</p>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-serif text-5xl text-[#E8E4DD]">{t.price}</span>
                  <span className="text-[12px] text-[#E8E4DD]/40">{t.period}</span>
                </div>
                <p className="mt-2 text-[13px] text-[#E8E4DD]/45 italic font-serif">{t.blurb}</p>
                <ul className="mt-7 space-y-2.5 text-[13px] text-[#E8E4DD]/60 flex-1">
                  {t.bullets.map((b) => (
                    <li key={b} className="flex gap-2.5">
                      <span className="text-[#E89A3C]/55">—</span>
                      {b}
                    </li>
                  ))}
                </ul>
                <Link
                  href={t.href}
                  className={`mt-10 inline-block py-2.5 text-center font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 ${
                    t.featured
                      ? 'bg-[#E89A3C] text-[#0D0C0A] hover:bg-[#E8E4DD]'
                      : 'border border-[#E8E4DD]/20 text-[#E8E4DD]/60 hover:border-[#E8E4DD]/50 hover:text-[#E8E4DD]'
                  }`}
                >
                  {t.cta} →
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-8 font-mono text-[10px] text-[#E8E4DD]/25">
            Prices in USD · Cancel any time · 14-day refund on first charge
          </p>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 007 · Questions
          </p>
          <h2 className="font-serif text-4xl text-[#E8E4DD] mb-14">Things people ask.</h2>
          <div className="border-t border-[#E8E4DD]/[0.08]">
            {FAQS.map((f) => (
              <details key={f.q} className="group border-b border-[#E8E4DD]/[0.08] py-6">
                <summary className="cursor-pointer flex items-start justify-between gap-6">
                  <span className="font-serif text-xl text-[#E8E4DD]">{f.q}</span>
                  <span className="font-mono text-[#E89A3C] text-xl leading-none transition-transform duration-500 group-open:rotate-45 mt-0.5 select-none">+</span>
                </summary>
                <p className="mt-5 text-[#E8E4DD]/60 leading-relaxed max-w-2xl">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-3xl">
          <h2 className="font-serif text-5xl md:text-7xl leading-[1.0] text-[#E8E4DD] mb-8">
            Install in{' '}
            <em className="italic text-[#E89A3C]">thirty seconds.</em>
          </h2>
          <p className="text-[#E8E4DD]/55 text-lg leading-relaxed mb-10 max-w-xl">
            Free to start. One command. Your AI remembers from the next session onward.
          </p>
          <div className="flex flex-wrap gap-5">
            <Link
              href="/login?signup=1"
              className="group inline-flex items-center gap-3 px-8 py-4 bg-[#E89A3C] text-[#0D0C0A] hover:bg-[#E8E4DD] transition-colors duration-500"
            >
              <span className="font-serif text-xl">Get started free</span>
              <span className="font-mono transition-transform duration-500 group-hover:translate-x-1">→</span>
            </Link>
            <Link
              href="/docs/mcp"
              className="group inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-[#E8E4DD]/40 hover:text-[#E89A3C] transition-colors duration-300 self-center"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="px-6 md:px-16 py-14 border-t border-[#E8E4DD]/[0.05]">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="block w-2 h-2 rounded-full bg-[#E89A3C] ember" />
              <p className="font-serif text-2xl text-[#E8E4DD]">Spine</p>
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/30">
              A memory layer for your AI
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-2">
            <div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase tracking-widest">
              {[
                ['/features', 'Features'],
                ['/pricing', 'Pricing'],
                ['/docs/mcp', 'Docs'],
                ['/docs/team-policies', 'Teams'],
                ['/privacy', 'Privacy'],
              ].map(([href, label]) => (
                <Link key={href} href={href} className="text-[#E8E4DD]/25 hover:text-[#E89A3C] transition-colors duration-300">
                  {label}
                </Link>
              ))}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/20">
              © {new Date().getFullYear()} · Built in Canberra
            </p>
          </div>
        </div>
      </footer>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ember {
          animation: emberGlow 3s ease-in-out infinite;
        }
        @keyframes emberGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(232,154,60,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(232,154,60,0); }
        }
      `}</style>
    </main>
  );
}
