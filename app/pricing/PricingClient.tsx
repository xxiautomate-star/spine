'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';

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

// LemonSqueezy is the PRIMARY checkout (one-click cards, simpler flow).
// PayPal is secondary — for users who insist on it (no card / international).
// Stripe routes exist as scaffolding but are dormant until KYC is in place.
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

async function startPaypalCheckout(plan: 'pro' | 'team'): Promise<void> {
  const res = await fetch('/api/paypal/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: plan }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: 'PayPal checkout failed.' }))) as { error?: string };
    throw new Error(err.error ?? 'PayPal checkout failed.');
  }
  const { approval_url } = (await res.json()) as { approval_url?: string };
  if (approval_url) window.location.href = approval_url;
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
  paypalLoading,
  onUpgrade,
  onPaypalUpgrade,
}: {
  tier: Tier;
  userId: string | null;
  loading: Plan | null;
  paypalLoading: Plan | null;
  onUpgrade: (plan: 'pro' | 'team') => void;
  onPaypalUpgrade: (plan: 'pro' | 'team') => void;
}) {
  function handleCta() {
    if (tier.plan === 'free') return; // handled by Link
    if (!userId) {
      // Preserve signup intent + plan choice through the magic-link round-trip.
      // /login reads `signup=1` to render the "Welcome in." copy, and `plan=`
      // routes the post-auth redirect into LemonSqueezy checkout.
      window.location.href = `/login?signup=1&plan=${tier.plan}&next=${encodeURIComponent(`/pricing?upgrade=${tier.plan}`)}`;
      return;
    }
    onUpgrade(tier.plan as 'pro' | 'team');
  }

  function handlePaypal() {
    if (tier.plan === 'free') return;
    if (!userId) {
      window.location.href = `/login?signup=1&plan=${tier.plan}&via=paypal&next=${encodeURIComponent(`/pricing?upgrade=${tier.plan}&via=paypal`)}`;
      return;
    }
    onPaypalUpgrade(tier.plan as 'pro' | 'team');
  }

  const isLoading = loading === tier.plan;
  const isPaypalLoading = paypalLoading === tier.plan;

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
          Most popular
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
            href={userId ? '/dashboard' : '/login?signup=1'}
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
          <>
            <button
              onClick={handleCta}
              disabled={isLoading || isPaypalLoading}
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

            {/* Secondary: PayPal — custom-styled to match marble + gold,
                no PayPal-branded chrome. Quiet by design. */}
            <div className="mt-4 flex items-center justify-center gap-3">
              <span
                className="h-px flex-1"
                style={{ background: 'var(--s-vein)' }}
                aria-hidden
              />
              <span
                className="font-mono text-[9px] uppercase tracking-[0.22em]"
                style={{ color: 'var(--s-ink-faint)' }}
              >
                Or
              </span>
              <span
                className="h-px flex-1"
                style={{ background: 'var(--s-vein)' }}
                aria-hidden
              />
            </div>

            <button
              onClick={handlePaypal}
              disabled={isLoading || isPaypalLoading}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 py-2.5 text-center font-mono text-[10px] uppercase tracking-[0.22em] transition-all duration-300 disabled:opacity-40"
              style={{
                background: 'transparent',
                color: 'var(--s-gold-deep)',
                border: 'none',
                borderBottom: '1px solid var(--s-vein-strong)',
                borderRadius: 0,
              }}
            >
              {isPaypalLoading ? 'Opening PayPal…' : 'Continue with PayPal →'}
            </button>
          </>
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
  const [paypalLoading, setPaypalLoading] = useState<Plan | null>(null);
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

  async function handlePaypalUpgrade(plan: 'pro' | 'team') {
    setError(null);
    setPaypalLoading(plan);
    try {
      await startPaypalCheckout(plan);
    } catch (e) {
      setError((e as Error).message);
      setPaypalLoading(null);
    }
  }

  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      {/* Marble texture overlays */}
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />

      {/* Gold-foil top edge */}
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

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
              paypalLoading={paypalLoading}
              onUpgrade={handleUpgrade}
              onPaypalUpgrade={handlePaypalUpgrade}
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

      <MarketingFooter />
    </main>
  );
}
