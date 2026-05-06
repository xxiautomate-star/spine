'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  PayPalScriptProvider,
  PayPalButtons,
  type ReactPayPalScriptOptions,
} from '@paypal/react-paypal-js';

// ── Types ───────────────────────────────────────────────────────────────────

type Tier = {
  id: string;
  name: string;
  tagline: string;
  price: number | null;
  period: string;
  features: string[];
  paypal_plan_id: string | null;
  featured?: boolean;
  cta: string;
};

type Props = {
  tiers: Tier[];
  currency: string;
  selectedTierId: string;
  paypalClientId: string | null;
};

// ── Component ───────────────────────────────────────────────────────────────

export function CheckoutClient({ tiers, currency, selectedTierId, paypalClientId }: Props) {
  const [activeTier, setActiveTier] = useState<string>(selectedTierId);
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const selected = useMemo(
    () => tiers.find((t) => t.id === activeTier) ?? tiers[0],
    [tiers, activeTier]
  );

  const paypalOptions: ReactPayPalScriptOptions = useMemo(
    () => ({
      clientId: paypalClientId ?? 'sandbox-placeholder',
      currency,
      intent: 'subscription',
      vault: true,
      components: 'buttons',
    }),
    [paypalClientId, currency]
  );

  return (
    <main
      className="relative marble-bg min-h-screen overflow-x-hidden"
      style={{ color: 'var(--s-ink)' }}
    >
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      {/* Nav */}
      <nav
        className="fixed top-0 inset-x-0 z-40 px-6 md:px-10 py-5 flex items-center justify-between"
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
              <linearGradient id="checkoutGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8c769" />
                <stop offset="55%" stopColor="#b8924a" />
                <stop offset="100%" stopColor="#7a5f2a" />
              </linearGradient>
            </defs>
            <circle
              cx="16"
              cy="16"
              r="14.5"
              stroke="url(#checkoutGold)"
              strokeWidth="1"
              fill="rgba(255,255,255,0.6)"
            />
            <path
              d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21"
              stroke="url(#checkoutGold)"
              strokeWidth="1.2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span
            className="font-serif text-[1.4rem] tracking-wide"
            style={{ color: 'var(--s-ink)' }}
          >
            Spine
          </span>
        </Link>
        <Link
          href="/pricing"
          className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-300 hover:[color:var(--s-ink)]"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          ← Back to pricing
        </Link>
      </nav>

      <section
        className="relative pt-32 pb-24 px-6 md:px-10 lg:px-16 max-w-6xl mx-auto"
        style={{ zIndex: 1 }}
      >
        {/* Editorial label */}
        <p
          className="font-mono text-[10px] uppercase tracking-[0.28em] mb-8"
          style={{ color: 'var(--s-gold-deep)' }}
        >
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>
            § Checkout
          </span>
          Subscribe
        </p>

        <h1
          className="font-serif text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] tracking-tight mb-4"
          style={{ color: 'var(--s-ink)' }}
        >
          Begin a memory that lasts.
        </h1>
        <p
          className="text-base md:text-lg max-w-xl mb-16"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          PayPal-secured. Cancel any time from your dashboard. Your memories stay yours.
        </p>

        {/* Tier picker */}
        <div className="grid md:grid-cols-3 gap-5 mb-12">
          {tiers.map((tier) => {
            const isActive = tier.id === activeTier;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => setActiveTier(tier.id)}
                className="text-left p-7 rounded-md transition-all duration-300"
                style={{
                  background: isActive
                    ? 'linear-gradient(180deg, #fdfaf2 0%, #f7f3e9 100%)'
                    : 'rgba(255, 253, 247, 0.65)',
                  border: isActive
                    ? '1px solid var(--s-gold)'
                    : '1px solid var(--s-vein)',
                  boxShadow: isActive
                    ? '0 2px 4px rgba(60,45,20,0.05), 0 16px 36px rgba(60,45,20,0.10)'
                    : '0 1px 2px rgba(60,45,20,0.03)',
                  cursor: 'pointer',
                }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3"
                  style={{
                    color: isActive ? 'var(--s-gold-deep)' : 'var(--s-ink-faint)',
                  }}
                >
                  {tier.featured ? 'Most chosen' : 'Plan'}
                </div>
                <div
                  className="font-serif text-2xl mb-2"
                  style={{ color: 'var(--s-ink)' }}
                >
                  {tier.name}
                </div>
                <div className="mb-4" style={{ color: 'var(--s-ink-soft)' }}>
                  <span className="font-serif text-3xl">
                    {tier.price === null ? 'TBD' : `$${tier.price}`}
                  </span>
                  <span className="font-mono text-xs ml-2 uppercase tracking-wider">
                    /{tier.period}
                  </span>
                </div>
                <p
                  className="text-sm mb-5 italic"
                  style={{ color: 'var(--s-ink-soft)' }}
                >
                  {tier.tagline}
                </p>
                <ul className="space-y-1.5 text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                  {tier.features.slice(0, 5).map((f) => (
                    <li key={f} className="flex gap-2">
                      <span style={{ color: 'var(--s-gold)' }}>·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        {/* Selected tier checkout panel */}
        {selected && (
          <div
            className="p-8 md:p-12 rounded-md max-w-2xl mx-auto"
            style={{
              background: 'rgba(255, 253, 247, 0.92)',
              border: '1px solid var(--s-vein-strong)',
              boxShadow:
                '0 2px 4px rgba(60,45,20,0.05), 0 16px 36px rgba(60,45,20,0.10)',
            }}
          >
            <p
              className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3"
              style={{ color: 'var(--s-gold-deep)' }}
            >
              You are subscribing to
            </p>
            <h2
              className="font-serif text-3xl mb-2"
              style={{ color: 'var(--s-ink)' }}
            >
              Spine {selected.name}
            </h2>
            <p
              className="text-sm mb-8 italic"
              style={{ color: 'var(--s-ink-soft)' }}
            >
              {selected.tagline}
            </p>

            <div
              className="h-px mb-8"
              style={{
                background:
                  'linear-gradient(90deg, transparent, var(--s-vein-strong) 50%, transparent)',
              }}
            />

            {status === 'success' && apiKey && (
              <div
                className="mb-6 p-5 rounded-md"
                style={{
                  background: 'rgba(184, 146, 74, 0.08)',
                  border: '1px solid var(--s-gold)',
                }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Subscription active
                </p>
                <p className="text-sm mb-3" style={{ color: 'var(--s-ink)' }}>
                  Your API key. Save it now — we will not show it again.
                </p>
                <code
                  className="block text-xs p-3 rounded font-mono break-all"
                  style={{
                    background: 'var(--s-bg-deep)',
                    color: 'var(--s-ink-strong)',
                  }}
                >
                  {apiKey}
                </code>
                <Link
                  href="/dashboard"
                  className="inline-block mt-4 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 hover:[color:var(--s-ink)]"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Continue to dashboard →
                </Link>
              </div>
            )}

            {status === 'error' && errorMessage && (
              <div
                className="mb-6 p-5 rounded-md"
                style={{
                  background: 'rgba(201, 125, 59, 0.08)',
                  border: '1px solid var(--s-amber-warm)',
                }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-2"
                  style={{ color: 'var(--s-amber-warm)' }}
                >
                  Could not complete
                </p>
                <p className="text-sm" style={{ color: 'var(--s-ink)' }}>
                  {errorMessage}
                </p>
              </div>
            )}

            {!paypalClientId && (
              <div
                className="mb-6 p-5 rounded-md"
                style={{
                  background: 'rgba(184, 146, 74, 0.06)',
                  border: '1px solid var(--s-vein-strong)',
                }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-2"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Checkout temporarily unavailable
                </p>
                <p className="text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                  PayPal credentials are not yet configured on the server. Join
                  the waitlist and we will email you the moment subscriptions
                  open.
                </p>
                <Link
                  href="/#waitlist"
                  className="inline-block mt-4 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 hover:[color:var(--s-ink)]"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Go to waitlist →
                </Link>
              </div>
            )}

            {paypalClientId && selected.paypal_plan_id && status !== 'success' && (
              <PayPalScriptProvider options={paypalOptions}>
                <PayPalButtons
                  style={{
                    layout: 'vertical',
                    color: 'gold',
                    shape: 'rect',
                    label: 'subscribe',
                  }}
                  createSubscription={(_, actions) =>
                    actions.subscription.create({
                      plan_id: selected.paypal_plan_id as string,
                    })
                  }
                  onApprove={async (data) => {
                    setStatus('pending');
                    try {
                      const res = await fetch('/api/spine/subscribe', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          subscription_id: data.subscriptionID,
                          tier_id: selected.id,
                        }),
                      });
                      const body = await res.json();
                      if (!res.ok) {
                        setStatus('error');
                        setErrorMessage(body.error ?? 'Subscription failed.');
                        return;
                      }
                      setApiKey(body.api_key);
                      setStatus('success');
                    } catch (err) {
                      setStatus('error');
                      setErrorMessage(
                        err instanceof Error ? err.message : 'Network error.'
                      );
                    }
                  }}
                  onError={(err) => {
                    setStatus('error');
                    setErrorMessage(
                      err instanceof Error ? err.message : 'PayPal error.'
                    );
                  }}
                />
              </PayPalScriptProvider>
            )}

            {paypalClientId && !selected.paypal_plan_id && (
              <div
                className="p-5 rounded-md"
                style={{
                  background: 'rgba(184, 146, 74, 0.06)',
                  border: '1px solid var(--s-vein-strong)',
                }}
              >
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.22em] mb-2"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Coming soon
                </p>
                <p className="text-sm mb-1" style={{ color: 'var(--s-ink)' }}>
                  Pricing for this tier is still being shaped.
                </p>
                <p className="text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                  Join the waitlist and we will tell you the moment it opens.
                </p>
                <Link
                  href="/#waitlist"
                  className="inline-block mt-4 font-mono text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 hover:[color:var(--s-ink)]"
                  style={{ color: 'var(--s-gold-deep)' }}
                >
                  Notify me when {selected.name} opens →
                </Link>
              </div>
            )}

            <p
              className="font-mono text-[10px] uppercase tracking-[0.22em] mt-8"
              style={{ color: 'var(--s-ink-faint)' }}
            >
              Secured by PayPal. Your card details never reach our servers.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
