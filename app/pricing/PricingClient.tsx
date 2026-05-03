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
      '200 memories',
      'Claude Code MCP integration',
      'Browser extension (ChatGPT, Gemini, Cursor)',
      'Vector recall',
      'JSON export, any time',
      'No credit card',
    ],
    cta: 'Get started',
  },
  {
    plan: 'pro',
    name: 'Pro',
    price: '$19',
    period: 'per month',
    tagline: 'The relationship deepens.',
    features: [
      'Unlimited memories',
      'Hybrid vector + BM25 retrieval',
      'Cross-encoder rerank',
      'Conflict detection + resolution',
      'Memory decay recovery',
      'Required-context pins',
      'Weekly retention digest',
    ],
    featured: true,
    cta: 'Start Pro',
  },
  {
    plan: 'team',
    name: 'Team',
    price: '$59',
    period: 'per month · 5 seats',
    tagline: 'Shared memory. Collective clarity.',
    features: [
      'Everything in Pro',
      'Shared workspace (up to 5 members)',
      'Team memory policies + enforcement',
      'Org audit log',
      'Priority support',
    ],
    cta: 'Start Team',
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

// Dashboards (/dashboard/billing, /billing) and the pricing page all share
// LemonSqueezy as the live checkout. Stripe routes exist as scaffolding but
// are dormant until KYC is in place — see /api/stripe/* for the dead path.
async function startCheckout(plan: 'pro' | 'team'): Promise<void> {
  const res = await fetch('/api/ls/checkout', {
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
    <div style={{ borderBottom: '1px solid var(--s-vein)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full py-6 flex items-start justify-between gap-6 text-left"
      >
        <span className="font-serif text-lg md:text-xl" style={{ color: 'var(--s-ink-strong)' }}>{q}</span>
        <span
          className={`font-mono text-xl leading-none flex-shrink-0 mt-0.5 transition-transform duration-500 ${open ? 'rotate-45' : ''}`}
          style={{ color: 'var(--s-gold-deep)' }}
          aria-hidden
        >
          +
        </span>
      </button>
      {open && (
        <p className="pb-6 text-[15px] leading-relaxed max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>{a}</p>
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
      className="relative flex flex-col p-8 md:p-10 rounded-xl transition-all duration-500 hover:translate-y-[-2px] overflow-hidden"
      style={{
        background: tier.featured
          ? 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)'
          : 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
        border: `1px solid ${tier.featured ? 'var(--s-vein-strong)' : 'var(--s-vein)'}`,
        boxShadow: tier.featured ? 'var(--s-shadow-2)' : 'var(--s-shadow-1)',
      }}
    >
      {tier.featured && (
        <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.95 }} />
      )}
      {tier.featured && (
        <span
          className="absolute -top-3 left-8 px-3 py-1 font-mono text-[9px] uppercase tracking-widest rounded-md"
          style={{
            background: 'var(--s-ink)',
            color: 'var(--s-bg-cool)',
            boxShadow: 'var(--s-shadow-1)',
          }}
        >
          Most chosen
        </span>
      )}

      <p
        className="font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{ color: tier.featured ? 'var(--s-gold-deep)' : 'var(--s-ink-faint)' }}
      >
        {tier.name}
      </p>

      <div className="mt-6 flex items-baseline gap-2">
        <span
          className="font-serif text-[3.25rem] leading-none"
          style={{ color: tier.featured ? 'var(--s-gold-deep)' : 'var(--s-ink)' }}
        >
          {tier.price}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--s-ink-faint)' }}>{tier.period}</span>
      </div>

      <p className="mt-3 font-serif italic text-[15px] leading-snug" style={{ color: 'var(--s-ink-soft)' }}>
        {tier.tagline}
      </p>

      <ul className="mt-8 space-y-3 flex-1">
        {tier.features.map((f) => (
          <li
            key={f}
            className="flex items-start gap-3 text-[14px] leading-snug"
            style={{ color: 'var(--s-ink-soft)' }}
          >
            <span style={{ color: 'var(--s-gold)' }} className="select-none mt-[1px]">—</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        {tier.plan === 'free' ? (
          <Link
            href={userId ? '/dashboard' : '/login'}
            className="inline-block w-full py-3 text-center font-mono text-[11px] uppercase tracking-widest transition-all duration-300 rounded-md"
            style={{
              background: 'transparent',
              color: 'var(--s-ink-soft)',
              border: '1px solid var(--s-vein-strong)',
            }}
          >
            {tier.cta} →
          </Link>
        ) : (
          <button
            onClick={handleCta}
            disabled={isLoading}
            className="inline-block w-full py-3 text-center font-mono text-[11px] uppercase tracking-widest transition-all duration-300 disabled:opacity-50 rounded-md"
            style={{
              background: tier.featured ? 'var(--s-ink)' : 'transparent',
              color: tier.featured ? 'var(--s-bg-cool)' : 'var(--s-ink-soft)',
              border: tier.featured ? '1px solid var(--s-ink)' : '1px solid var(--s-vein-strong)',
              boxShadow: tier.featured ? 'var(--s-shadow-1)' : 'none',
            }}
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
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      {/* Marble texture overlays */}
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />

      {/* Gold-foil top edge */}
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      {/* Nav */}
      <header
        className="sticky top-0 z-40 px-6 md:px-10 py-5 flex items-center justify-between"
        style={{
          background: 'rgba(255, 253, 247, 0.78)',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          borderBottom: '1px solid var(--s-vein)',
        }}
      >
        <Link href="/" className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
            <defs>
              <linearGradient id="spinePricingGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8c769" />
                <stop offset="55%" stopColor="#b8924a" />
                <stop offset="100%" stopColor="#7a5f2a" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="14.5" stroke="url(#spinePricingGold)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
            <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spinePricingGold)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
          <span className="font-serif text-xl" style={{ color: 'var(--s-ink)' }}>Spine</span>
        </Link>
        <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link
            href="/features"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Features
          </Link>
          <Link
            href="/proof"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Proof
          </Link>
          <Link
            href="/docs/mcp"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Docs
          </Link>
          {userEmail ? (
            <>
              <span className="hidden md:block" style={{ color: 'var(--s-ink-ghost)' }}>{userEmail}</span>
              <Link
                href="/dashboard"
                className="transition-colors duration-300 hover:[color:var(--s-ink)]"
                style={{ color: 'var(--s-gold-deep)' }}
              >
                Dashboard →
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="transition-colors duration-300 hover:[color:var(--s-ink)]"
              style={{ color: 'var(--s-ink-soft)' }}
            >
              Sign in →
            </Link>
          )}
        </div>
      </header>

      <div className="relative max-w-5xl mx-auto px-6 md:px-10" style={{ zIndex: 1 }}>

        {/* Hero */}
        <div className="pt-20 pb-16 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
            Pricing
          </p>
          <h1
            className="font-serif text-[clamp(3rem,8vw,6rem)] leading-[0.92] tracking-[-0.025em] mb-5"
            style={{ color: 'var(--s-ink)' }}
          >
            Pay for what{' '}
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>lasts.</em>
          </h1>
          <p className="text-[15px] leading-relaxed max-w-xl" style={{ color: 'var(--s-ink-soft)' }}>
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
          <p className="mt-6 text-center font-mono text-[11px]" style={{ color: 'var(--s-amber-warm)' }}>{error}</p>
        )}

        {/* Trust line */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rise rise-3">
          {[
            'Cancel any time',
            'No dark patterns',
            'Data exportable as JSON',
            'Encrypted at rest',
          ].map((item) => (
            <span
              key={item}
              className="font-mono text-[10px] uppercase tracking-wider flex items-center gap-2"
              style={{ color: 'var(--s-ink-faint)' }}
            >
              <span
                className="w-[4px] h-[4px] rounded-full inline-block"
                style={{ background: 'var(--s-gold)' }}
              />
              {item}
            </span>
          ))}
        </div>

        {/* Comparison note */}
        <div
          className="mt-20 mb-12 pt-16 rise rise-3"
          style={{ borderTop: '1px solid var(--s-vein)' }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 002</span>
            Foundation
          </p>
          <h2 className="font-serif text-3xl md:text-4xl mb-3" style={{ color: 'var(--s-ink)' }}>
            All plans include.
          </h2>
          <p className="text-sm mb-10" style={{ color: 'var(--s-ink-soft)' }}>
            Every Spine account starts with this foundation.
          </p>
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
              <div
                key={item}
                className="flex items-start gap-3 text-[14px]"
                style={{ color: 'var(--s-ink-soft)' }}
              >
                <span style={{ color: 'var(--s-gold)' }} className="mt-[2px] flex-shrink-0">—</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div
          className="pt-16 pb-4 rise rise-4"
          style={{ borderTop: '1px solid var(--s-vein)' }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 003</span>
            Questions
          </p>
          <h2 className="font-serif text-3xl md:text-4xl mb-10" style={{ color: 'var(--s-ink)' }}>
            Things people ask.
          </h2>
          <div style={{ borderTop: '1px solid var(--s-vein)' }}>
            {FAQS.map((f) => (
              <FaqItem key={f.q} q={f.q} a={f.a} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="py-24 text-center rise rise-5">
          <p className="font-serif italic text-2xl mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            Still not sure? Read the archive.
          </p>
          <Link
            href="/proof"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest pb-[1px] transition-all duration-300"
            style={{
              color: 'var(--s-gold-deep)',
              borderBottom: '1px solid var(--s-vein-strong)',
            }}
          >
            Open the diary →
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="relative px-6 md:px-10 py-12"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
              <defs>
                <linearGradient id="spinePricingFootGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#e8c769" />
                  <stop offset="55%" stopColor="#b8924a" />
                  <stop offset="100%" stopColor="#7a5f2a" />
                </linearGradient>
              </defs>
              <circle cx="16" cy="16" r="14.5" stroke="url(#spinePricingFootGold)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
              <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spinePricingFootGold)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            </svg>
            <span className="font-serif text-lg" style={{ color: 'var(--s-ink)' }}>Spine</span>
          </div>
          <div className="flex gap-6 font-mono text-[10px] uppercase tracking-widest">
            {[
              ['/', 'Home'],
              ['/features', 'Features'],
              ['/proof', 'Proof'],
              ['/privacy', 'Privacy'],
              ['/docs/mcp', 'Docs'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
                style={{ color: 'var(--s-ink-faint)' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
