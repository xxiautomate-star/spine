import WaitlistForm from '@/components/WaitlistForm';
import { TrialCTA } from '@/components/TrialCTA';

type Tier = {
  name: string;
  price: string;
  period: string;
  blurb: string;
  bullets: string[];
  cta: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    blurb: 'A quiet beginning. Enough to see what changes.',
    bullets: [
      '100 memories',
      'Claude Code MCP integration',
      'Export to JSON any time',
      'No credit card',
    ],
    cta: 'Start free',
  },
  {
    name: 'Pro',
    price: '$9',
    period: 'per month',
    blurb: 'The relationship deepens. Across every AI you use.',
    bullets: [
      'Unlimited memories',
      'Claude, ChatGPT, and Gemini',
      'Proactive context surfacing',
      'Private cloud sync across devices',
      'Priority support',
    ],
    cta: 'Request access',
    featured: true,
  },
  {
    name: 'Power',
    price: '$29',
    period: 'per month',
    blurb: 'For teams and the obsessively organised.',
    bullets: [
      'Everything in Pro',
      'Team-shared memory spaces',
      'Background agents',
      'Automation triggers',
      'Up to 5 seats',
    ],
    cta: 'Request access',
  },
];

const FAQS = [
  {
    q: 'Is my data private?',
    a: 'Yes. Your memories are stored in your own isolated row of our database, encrypted at rest. We do not train on them, we do not sell them, and you can delete everything in one click. A self-hosted option for teams is on the roadmap.',
  },
  {
    q: 'Which AIs does Spine support?',
    a: 'At launch, Claude Code and Claude Desktop via Anthropic\u2019s MCP protocol. Cursor, Windsurf, and any other MCP-compatible client work the same day. ChatGPT and Gemini support arrive shortly after via a browser extension.',
  },
  {
    q: 'Can I export or delete my memories?',
    a: 'Any time, in JSON or Markdown. There is no lock-in, no retention period, no ceremony. Leaving should be as easy as arriving.',
  },
  {
    q: 'How do I cancel?',
    a: 'From the dashboard. Cancel within 14 days of starting a paid plan and we refund the rest of the cycle. After that, your plan runs out the period you already paid for and quietly ends.',
  },
  {
    q: 'Can my team share a Spine?',
    a: 'Power includes shared memory spaces for up to five teammates. Larger teams, write to us and we\u2019ll work something out.',
  },
];

export default function Home() {
  return (
    <main className="relative">
      <nav className="fixed top-0 inset-x-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/60 border-b border-cream/5">
        <a href="#top" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl tracking-wide">Spine</span>
        </a>
        <div className="flex items-center gap-5">
          <a
            href="/demo"
            className="font-mono text-xs uppercase tracking-widest text-amber/80 hover:text-amber transition-colors duration-500"
          >
            Live demo
          </a>
          <a
            href="#waitlist"
            className="font-mono text-xs uppercase tracking-widest text-cream/70 hover:text-amber transition-colors duration-500"
          >
            Request access →
          </a>
        </div>
      </nav>

      <section
        id="top"
        className="relative min-h-[92vh] flex flex-col justify-center px-6 md:px-16 pt-36 pb-24 overflow-hidden"
      >
        <div
          className="absolute left-1/4 top-1/3 w-[680px] h-[680px] rounded-full bg-amber/20 blur-[140px] ember pointer-events-none"
          aria-hidden
        />
        <div
          className="absolute right-0 bottom-0 w-[420px] h-[420px] rounded-full bg-ink/30 blur-[160px] pointer-events-none"
          aria-hidden
        />
        <div className="relative max-w-5xl">
          <p className="rise rise-1 font-mono text-[11px] uppercase tracking-widest text-amber">
            § 001 &middot; SPINE &middot; Private beta
          </p>
          <h1 className="rise rise-2 mt-8 font-serif text-[2.9rem] leading-[1.02] md:text-7xl lg:text-[7.5rem] lg:leading-[0.98] tracking-tight text-cream">
            Your AI{' '}
            <em className="italic text-amber">forgets you</em>
            <br className="hidden md:block" />
            <span className="md:ml-0"> every morning.</span>
            <br />
            We fix that.
          </h1>
          <p className="rise rise-3 mt-10 max-w-2xl text-lg md:text-xl text-cream/70 leading-relaxed">
            Spine is a quiet memory layer beneath your assistant. It captures what matters across every conversation
            and returns it when it counts, so your AI stops meeting you for the first time, each morning, forever.
          </p>
          <div className="rise rise-4 mt-12 flex flex-wrap items-center gap-6">
            <a
              href="#waitlist"
              className="group inline-flex items-center gap-3 px-6 py-3 bg-cream text-night hover:bg-amber transition-colors duration-500"
            >
              <span className="font-serif text-lg">Request access</span>
              <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
            </a>
            <a
              href="/demo"
              className="group inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-cream/60 hover:text-amber transition-colors duration-500"
            >
              <span className="block w-1.5 h-1.5 rounded-full bg-amber animate-pulse" aria-hidden />
              See live archive
            </a>
            <a
              href="#how"
              className="font-mono text-xs uppercase tracking-widest text-cream/40 hover:text-cream transition-colors duration-500"
            >
              How it works
            </a>
          </div>
          <p className="rise rise-5 mt-16 font-mono text-[11px] uppercase tracking-widest text-cream/40">
            MCP · Claude · ChatGPT · Gemini · Cursor
          </p>
        </div>
      </section>

      {/* Demo video */}
      <section className="px-6 md:px-16 py-16 md:py-20 border-t border-cream/5">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber">
              § 002 &middot; 30-second demo
            </p>
            <a
              href="/demo"
              className="font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-amber transition-colors duration-300"
            >
              Browse live archive →
            </a>
          </div>
          <div className="relative rounded-xl overflow-hidden border border-cream/10 bg-cream/[0.02] aspect-video">
            <video
              autoPlay
              muted
              loop
              playsInline
              poster="/demo-poster.jpg"
              className="w-full h-full object-cover"
            >
              <source src="/demo.mp4" type="video/mp4" />
            </video>
            {/* Fallback when no video file is present */}
            <noscript>
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="font-serif text-2xl text-cream/40">Demo video loading…</p>
              </div>
            </noscript>
            {/* Overlay gradient at bottom */}
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-night/60 to-transparent pointer-events-none" />
          </div>
          <p className="mt-3 font-mono text-[10px] text-cream/25 text-center">
            Claude Code session · Spine recalls 2 prior memories · context shapes the answer
          </p>
        </div>
      </section>

      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-cream/5">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-10">
            § 003 &middot; The problem
          </p>
          <div className="font-serif text-2xl md:text-[2rem] leading-[1.4] text-cream/90 space-y-7">
            <p>
              Every conversation with your AI begins the same way — a stranger asking your name. What you told it
              yesterday has vanished. The project you have been working on for months reintroduces itself each
              morning. You re-brief. You re-explain. You attach the same three files, and then the same three files
              again tomorrow.
            </p>
            <p>
              This is the cold start, and it is the quiet tax on every power user of every AI — the invisible hours
              spent repairing context that should simply persist. System prompts. Scratchpads. Sprawling memory
              files in project folders. Rituals built to work around an amnesia nobody asked for.
            </p>
            <p className="text-cream">
              Spine is a thin layer beneath your AI that remembers. Privately. Permanently. Across sessions,
              across models, across the whole life of the relationship.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="px-6 md:px-16 py-28 md:py-40 border-t border-cream/5">
        <div className="max-w-6xl">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-10">
            § 004 &middot; How it works
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-cream max-w-3xl">
            Thirty seconds to a memory that stays.
          </h2>

          <ol className="mt-16 space-y-16">
            <li className="grid md:grid-cols-[auto,1fr] gap-6 md:gap-14 items-start">
              <span className="font-mono text-xs text-cream/40 md:pt-2">01</span>
              <div>
                <h3 className="font-serif text-2xl md:text-3xl text-cream mb-4">Install</h3>
                <p className="text-cream/70 leading-relaxed max-w-xl mb-5">
                  One command in your terminal. Spine registers as an MCP server with Claude Code and Claude Desktop.
                  No account required to begin — sign in later when you want your memories to sync.
                </p>
                <pre className="inline-block font-mono text-sm bg-cream/[0.04] border border-cream/10 text-amber px-4 py-3">
                  <span className="text-cream/40 select-none">$ </span>npx @spine/mcp init
                </pre>
              </div>
            </li>

            <li className="grid md:grid-cols-[auto,1fr] gap-6 md:gap-14 items-start">
              <span className="font-mono text-xs text-cream/40 md:pt-2">02</span>
              <div>
                <h3 className="font-serif text-2xl md:text-3xl text-cream mb-4">Your AI remembers</h3>
                <p className="text-cream/70 leading-relaxed max-w-xl">
                  Work as you normally do. Facts worth keeping — your stack, your goals, the shape of the thing you
                  are building — are quietly filed by the assistant itself, using the tools Spine exposes. Nothing
                  to click. Nothing to re-paste.
                </p>
              </div>
            </li>

            <li className="grid md:grid-cols-[auto,1fr] gap-6 md:gap-14 items-start">
              <span className="font-mono text-xs text-cream/40 md:pt-2">03</span>
              <div>
                <h3 className="font-serif text-2xl md:text-3xl text-cream mb-4">Context compounds</h3>
                <p className="text-cream/70 leading-relaxed max-w-xl">
                  Each session begins where the last one ended. Over weeks, your AI stops guessing and starts
                  remembering. It becomes, in a real sense, yours — shaped by every conversation you have ever had
                  with it.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* One-click install */}
      <section className="px-6 md:px-16 py-16 md:py-24 border-t border-cream/5">
        <div className="max-w-3xl mx-auto">
          <TrialCTA />
        </div>
      </section>

      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-cream/5">
        <div className="max-w-6xl">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-10">
            § 005 &middot; Pricing
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-cream max-w-3xl mb-16">
            Pay for the memory you need.
          </h2>

          <div className="grid md:grid-cols-3 gap-5 md:gap-6">
            {TIERS.map((t) => (
              <div
                key={t.name}
                className={`relative flex flex-col p-8 md:p-10 border transition-colors duration-500 ${
                  t.featured
                    ? 'border-amber/40 bg-amber/[0.035]'
                    : 'border-cream/10 hover:border-cream/30'
                }`}
              >
                {t.featured && (
                  <span className="absolute -top-3 left-8 px-2 py-0.5 bg-amber text-night font-mono text-[10px] uppercase tracking-widest">
                    Most chosen
                  </span>
                )}
                <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50">{t.name}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="font-serif text-5xl md:text-6xl text-cream">{t.price}</span>
                  <span className="text-sm text-cream/50">{t.period}</span>
                </div>
                <p className="mt-3 text-sm text-cream/60 italic font-serif">{t.blurb}</p>
                <ul className="mt-8 space-y-3 text-[15px] text-cream/70 flex-1">
                  {t.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className="text-amber/70 select-none">—</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="#waitlist"
                  className={`mt-10 inline-block py-2 border-b self-start transition-colors duration-500 ${
                    t.featured
                      ? 'text-amber border-amber/60 hover:border-amber'
                      : 'text-cream border-cream/30 hover:border-cream'
                  }`}
                >
                  {t.cta} →
                </a>
              </div>
            ))}
          </div>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-widest text-cream/40">
            Prices in USD. Cancel any time from the dashboard.
          </p>
        </div>
      </section>

      <section className="px-6 md:px-16 py-28 md:py-40 border-t border-cream/5">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-10">
            § 006 &middot; Questions
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-cream mb-16">
            Things people ask.
          </h2>
          <div className="border-t border-cream/10">
            {FAQS.map((f) => (
              <details key={f.q} className="group border-b border-cream/10 py-6">
                <summary className="cursor-pointer flex items-start justify-between gap-6">
                  <span className="font-serif text-xl md:text-2xl text-cream">{f.q}</span>
                  <span className="font-mono text-amber text-xl leading-none transition-transform duration-500 group-open:rotate-45 mt-1 select-none">
                    +
                  </span>
                </summary>
                <p className="mt-5 text-cream/70 leading-relaxed max-w-2xl">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="waitlist" className="px-6 md:px-16 py-28 md:py-40 border-t border-cream/5">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-10">
            § 007 &middot; Request access
          </p>
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.05] text-cream mb-6">
            We are opening slowly.
          </h2>
          <p className="text-cream/70 text-lg leading-relaxed mb-12 max-w-xl">
            Spine is in private beta while we sharpen the edges. Leave your email and we will write when there is a
            seat — usually within a week, sometimes sooner.
          </p>
          <WaitlistForm />
        </div>
      </section>

      <footer className="px-6 md:px-16 py-14 border-t border-cream/5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
              <p className="font-serif text-2xl text-cream">Spine</p>
            </div>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-cream/40">
              A memory layer for your AI
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-2">
            <div className="flex gap-6 font-mono text-[11px] uppercase tracking-widest">
              <a href="/demo" className="text-cream/30 hover:text-amber transition-colors duration-300">Live demo</a>
              <a href="/privacy" className="text-cream/30 hover:text-amber transition-colors duration-300">Privacy</a>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-cream/30">
              © {new Date().getFullYear()} &middot; Built quietly in Canberra
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
