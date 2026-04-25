'use client';

import Link from 'next/link';
import { useState } from 'react';

// ── Plan data ─────────────────────────────────────────────────────────────

type Plan = 'free' | 'pro' | 'team';

type Tier = {
  plan: Plan;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  featured?: boolean;
  cta: string;
};

const TIERS: Tier[] = [
  {
    plan: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    tagline: 'A quiet beginning. Enough to feel the shape of it.',
    features: [
      '100 memories',
      'Claude Code MCP integration',
      'Vector recall',
      'JSON export, any time',
      'No credit card',
    ],
    cta: 'Get started',
  },
  {
    plan: 'pro',
    name: 'Pro',
    price: '$29',
    period: 'per month',
    tagline: 'Your daily archive. Across every AI you use.',
    features: [
      '1,000 memories',
      'Claude, ChatGPT, and Gemini',
      'Chrome extension capture',
      'Hybrid vector + BM25 retrieval',
      'Haiku 4.5 reranker',
      'Priority support',
    ],
    featured: true,
    cta: 'Start Pro',
  },
  {
    plan: 'team',
    name: 'Power',
    price: '$99',
    period: 'per month',
    tagline: 'Unlimited memory, forever. For the obsessively organised.',
    features: [
      'Unlimited memories',
      'Everything in Pro',
      'Priority Haiku reranker',
      'Team-shared archives',
      'Automation triggers',
      'Dedicated support',
    ],
    cta: 'Start Power',
  },
];

const FAQS = [
  {
    q: 'Can I change plans later?',
    a: 'Yes — upgrade or downgrade any time from your dashboard. Changes take effect immediately. If you downgrade from Power to Pro or Free, memories beyond the new cap are not deleted — they are archived and restored if you upgrade again.',
  },
  {
    q: 'What counts as a memory?',
    a: 'Each distinct fact, decision, or piece of context your AI captures is one memory. A single conversation might produce between one and a dozen memories depending on density. The MCP server decides what is worth keeping.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Memories are stored in your own isolated row of our database, encrypted at rest. We do not train on them, we do not sell them, and you can delete everything in one click at any time.',
  },
  {
    q: 'How do I cancel?',
    a: 'From your dashboard billing page. Cancel within 14 days of your first charge and we refund the remainder. After that, your plan runs to the end of the period you paid for and ends quietly — no dark patterns.',
  },
  {
    q: 'Do team seats share a single archive?',
    a: 'Power includes shared memory spaces where teammates can contribute to and draw from a common archive. Individual private archives coexist. Larger teams — write to us.',
  },
];

// ── Checkout logic ────────────────────────────────────────────────────────

async function startCheckout(plan: 'pro' | 'team'): Promise<void> {
  const res = await fetch('/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'Checkout failed.' }))) as { error?: string };
    throw new Error(err.error ?? 'Checkout failed.');
  }
  const { url } = (await res.json()) as { url?: string };
  if (url) window.location.href = url;
}

// ── FAQ item ─────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-cream/[0.08]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full py-6 flex items-start justify-between gap-6 text-left"
      >
        <span className="font-serif text-lg md:text-xl text-cream/85">{q}</span>
        <span
          className={`font-mono text-amber text-xl leading-none flex-shrink-0 mt-0.5 transition-transform duration-500 ${open ? 'rotate-45' : ''}`}
          aria-hidden
        >
          +
        </span>
      </button>
      {open && (
        <p className="pb-6 text-[15px] leading-relaxed text-cream/55 max-w-2xl">{a}</p>
      )}
    </div>
  );
}

// ── Tier card ─────────────────────────────────────────────────────────────

function TierCard({
  tier,
  userId,
  loading,
  onUpgrade,
}: {
  tier: Tier;
  userId: string | null;
  loading: Plan | null;
  onUpgrade: (plan: 'pro' | 'team') => void;
}) {
  const isPaid = tier.plan !== 'free';

  function handleCta() {
    if (tier.plan === 'free') return; // handled by Link
    if (!userId) {
      window.location.href = `/login?next=/pricing`;
      return;
    }
    onUpgrade(tier.plan as 'pro' | 'team');
  }

  const isLoading = loading === tier.plan;

  return (
    <div
      className={`relative flex flex-col p-8 md:p-10 border transition-all duration-500 ${
        tier.featured
          ? 'border-amber/35 bg-amber/[0.03] shadow-[0_0_80px_-30px_rgba(232,154,60,0.18)]'
          : 'border-cream/[0.08] hover:border-cream/20'
      }`}
    >
      {tier.featured && (
        <div className="absolute -top-px inset-x-0 h-px bg-gradient-to-r from-transparent via-amber/60 to-transparent" />
      )}
      {tier.featured && (
        <span className="absolute -top-3 left-8 px-2.5 py-0.5 bg-amber text-night font-mono text-[9px] uppercase tracking-widest">
          Most chosen
        </span>
      )}

      <p className={`font-mono text-[10px] uppercase tracking-widest ${tier.featured ? 'text-amber/80' : 'text-cream/40'}`}>
        {tier.name}
      </p>

      <div className="mt-6 flex items-baseline gap-2">
        <span className="font-serif text-[3.25rem] leading-none text-cream">{tier.price}</span>
        <span className="text-[13px] text-cream/35">{tier.period}</span>
      </div>

      <p className="mt-3 font-serif italic text-[15px] text-cream/50 leading-snug">{tier.tagline}</p>

      <ul className="mt-8 space-y-3 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-[14px] text-cream/65 leading-snug">
            <span className="text-amber/50 select-none mt-[1px]">—</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        {tier.plan === 'free' ? (
          <Link
            href={userId ? '/dashboard' : '/login'}
            className="inline-flex items-center gap-2 py-2 border-b border-cream/25 hover:border-cream text-cream/70 hover:text-cream font-mono text-[11px] uppercase tracking-wider transition-all duration-300"
          >
            {tier.cta} →
          </Link>
        ) : (
          <button
            onClick={handleCta}
            disabled={isLoading}
            className={`inline-flex items-center gap-2 py-2 border-b font-mono text-[11px] uppercase tracking-wider transition-all duration-300 disabled:opacity-50 ${
              tier.featured
                ? 'border-amber/60 text-amber hover:border-amber'
                : 'border-cream/25 text-cream/70 hover:border-cream hover:text-cream'
            }`}
          >
            {isLoading ? 'Opening checkout…' : `${tier.cta} →`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export function PricingClient({
  userId,
  userEmail,
}: {
  userId: string | null;
  userEmail: string | null;
}) {
  const [loading, setLoading] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpgrade(plan: 'pro' | 'team') {
    setError(null);
    setLoading(plan);
    try {
      await startCheckout(plan);
    } catch (e) {
      setError((e as Error).message);
      setLoading(null);
    }
  }

  return (
    <>
      {/* Atmosphere */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] rounded-full bg-amber/[0.05] blur-[220px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-ink/20 blur-[200px]" />
        <svg className="absolute inset-0 w-full h-full opacity-[0.022]" xmlns="http://www.w3.org/2000/svg">
          <filter id="noise-p">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#noise-p)" />
        </svg>
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/75 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/demo" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">
            Demo
          </Link>
          <Link href="/install" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">
            Install
          </Link>
          {userEmail ? (
            <>
              <span className="text-cream/22 hidden md:block">{userEmail}</span>
              <Link href="/dashboard" className="text-amber/70 hover:text-amber transition-colors duration-300">
                Dashboard →
              </Link>
            </>
          ) : (
            <Link href="/login" className="text-cream/50 hover:text-amber transition-colors duration-300">
              Sign in →
            </Link>
          )}
        </div>
      </header>

      <div className="relative max-w-5xl mx-auto px-6 md:px-10">

        {/* Hero */}
        <div className="pt-20 pb-16 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-5">Pricing</p>
          <h1 className="font-serif text-[clamp(3rem,8vw,6rem)] leading-[0.92] tracking-[-0.015em] text-cream/90 mb-5">
            Pay for what lasts.
          </h1>
          <p className="text-cream/40 text-[15px] leading-relaxed max-w-xl">
            Start free, no card required. Upgrade when your archive outgrows the beginning.
            Billed monthly. Cancel any time from the dashboard.
          </p>
        </div>

        {/* Tier cards */}
        <div className="grid md:grid-cols-3 gap-4 md:gap-5 rise rise-2">
          {TIERS.map((t) => (
            <TierCard
              key={t.plan}
              tier={t}
              userId={userId}
              loading={loading}
              onUpgrade={handleUpgrade}
            />
          ))}
        </div>

        {error && (
          <p className="mt-6 text-center font-mono text-[11px] text-amber/70">{error}</p>
        )}

        {/* Trust line */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rise rise-3">
          {[
            'Cancel any time',
            'No dark patterns',
            'Data exportable as JSON',
            'Encrypted at rest',
          ].map((item) => (
            <span key={item} className="font-mono text-[10px] uppercase tracking-wider text-cream/22 flex items-center gap-2">
              <span className="w-[4px] h-[4px] rounded-full bg-amber/30 inline-block" />
              {item}
            </span>
          ))}
        </div>

        {/* Comparison note */}
        <div className="mt-20 mb-12 border-t border-cream/[0.06] pt-16 rise rise-3">
          <h2 className="font-serif text-3xl md:text-4xl text-cream/85 mb-3">
            All plans include.
          </h2>
          <p className="text-cream/35 text-sm mb-10">Every Spine account starts with this foundation.</p>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4">
            {[
              'MCP protocol (Claude Code + Desktop)',
              'Cursor and Windsurf support',
              'Semantic vector search',
              'Memory tagging and filtering',
              'Timeline dashboard',
              'JSON and Markdown export',
              'Cross-device sync',
              'GDPR-compliant deletion',
              'Supabase-backed — your data is yours',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 text-[14px] text-cream/55">
                <span className="text-amber/35 mt-[2px] flex-shrink-0">—</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="border-t border-cream/[0.06] pt-16 pb-4 rise rise-4">
          <h2 className="font-serif text-3xl md:text-4xl text-cream/85 mb-10">
            Questions.
          </h2>
          <div className="border-t border-cream/[0.08]">
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="py-24 text-center rise rise-5">
          <p className="font-serif italic text-2xl text-cream/30 mb-6">
            Still not sure? Read the archive.
          </p>
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-amber/60 hover:text-amber border-b border-amber/25 hover:border-amber/60 pb-[1px] transition-all duration-300"
          >
            Browse the live demo →
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-cream/[0.05] px-6 md:px-10 py-12">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="flex items-center gap-3">
            <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
            <span className="font-serif text-lg text-cream">Spine</span>
          </div>
          <div className="flex gap-6 font-mono text-[10px] uppercase tracking-widest text-cream/25">
            <Link href="/" className="hover:text-amber transition-colors duration-300">Home</Link>
            <Link href="/demo" className="hover:text-amber transition-colors duration-300">Demo</Link>
            <Link href="/privacy" className="hover:text-amber transition-colors duration-300">Privacy</Link>
            <Link href="/install" className="hover:text-amber transition-colors duration-300">Install</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
