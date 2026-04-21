import Link from 'next/link';
import { ConflictHeroLoop } from '@/components/ConflictHeroLoop';

export const metadata = {
  title: 'Spine — Your AI remembers every word',
  description: 'A memory layer for Claude, ChatGPT, and Gemini. Captures what matters across every conversation. Returns it when it counts.',
};

const STEPS = [
  {
    n: '01',
    title: 'Install in 30 seconds',
    body: 'One command wires Spine into Claude Code, Claude Desktop, Cursor, or any MCP-compatible AI. No account required to begin.',
    code: 'npx xxiautomate-spine init',
  },
  {
    n: '02',
    title: 'Your AI remembers',
    body: "Work as you normally do. Facts worth keeping are quietly filed by the assistant itself — your stack, your goals, every decision that shapes the thing you're building.",
    code: null,
  },
  {
    n: '03',
    title: 'Context compounds',
    body: 'Each session begins where the last one ended. Over weeks, contradictions surface, stale knowledge ages out, and what remains is an increasingly accurate model of you.',
    code: null,
  },
];

const FAQS = [
  {
    q: 'Is my data private?',
    a: 'Yes. Your memories live in your own isolated workspace, encrypted at rest. We do not train on them. Export or delete in one click — no ceremony.',
  },
  {
    q: 'Which AIs does Spine support?',
    a: 'Claude Code and Claude Desktop via MCP from day one. ChatGPT and Gemini via the browser extension. Any MCP-compatible client (Cursor, Windsurf) works the same day.',
  },
  {
    q: 'What is conflict detection?',
    a: 'When you capture something that contradicts a prior memory — "we use Stripe" then "we switched to PayPal" — Spine creates a conflict and surfaces it as an overlay in your browser. You keep the latest, both, or resolve manually.',
  },
  {
    q: 'What happens to old memories?',
    a: 'Memories not accessed in 60 days are soft-archived — still recoverable from your timeline, just not injected into context. The weekly digest flags stale memories with a one-click revive.',
  },
  {
    q: 'Can my team share a Spine?',
    a: 'Yes. The Team plan gives up to 5 members a shared memory workspace with policy enforcement and an audit log.',
  },
];

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
              <span className="font-serif text-lg">Install in 2 minutes</span>
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

        {/* Right: animated conflict HUD demo */}
        <div className="relative hidden lg:flex items-center justify-center pr-12 py-16">
          <ConflictHeroLoop />
        </div>
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

      {/* ── Features callout ──────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-6xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 004 · Beyond simple memory
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: '⚡',
                title: 'Conflict detection',
                body: 'When a new capture contradicts a prior memory, Spine surfaces both versions in an inline HUD. Keep latest, keep both, or resolve manually. Unresolved conflicts show in your daily digest.',
              },
              {
                icon: '⏳',
                title: 'Memory decay',
                body: 'Memories not accessed in 60 days are soft-archived — still recoverable, just quiet. Your archive stays sharp, not cluttered. Revive any memory in one click from the weekly digest.',
              },
              {
                icon: '📌',
                title: 'Required-context pins',
                body: 'Pin a memory to force it into every retrieval, regardless of similarity score. For facts that must always be present: allergies, hard technical constraints, non-negotiables.',
              },
              {
                icon: '🔍',
                title: 'Entity knowledge graph',
                body: 'Every person, project, tool, and decision you mention is extracted and linked. The /graph view shows how your work connects. Fuzzy-matched entities are automatically proposed for merging.',
              },
              {
                icon: '👥',
                title: 'Team shared memory',
                body: 'On the Team plan, every workspace member shares the same memory graph. Required-context pins apply org-wide. Policy changes are logged in the org audit trail.',
              },
              {
                icon: '📬',
                title: 'Weekly retention digest',
                body: 'Every Monday morning: how many memories you captured, conflicts resolved, which are going stale, and a histogram of your memory archive by age. The digest arrives in your inbox.',
              },
            ].map((f) => (
              <div key={f.title} className="p-6 border border-[#E8E4DD]/[0.07] rounded-xl hover:border-[#E8E4DD]/[0.15] transition-colors duration-300">
                <p className="text-2xl mb-4">{f.icon}</p>
                <h3 className="font-serif text-xl text-[#E8E4DD]/85 mb-3">{f.title}</h3>
                <p className="text-[#E8E4DD]/45 text-[13px] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/features" className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/60 hover:text-[#E89A3C] transition-colors border-b border-[#E89A3C]/25 hover:border-[#E89A3C]/60 pb-px">
              Full feature list →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-[#E8E4DD]/[0.05]">
        <div className="max-w-6xl">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-10">
            § 005 · Pricing
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
                  bullets: ['50 memories', 'Claude Code MCP', 'Browser extension', 'Export any time'],
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
            § 006 · Questions
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
            <em className="italic text-[#E89A3C]">two minutes.</em>
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
