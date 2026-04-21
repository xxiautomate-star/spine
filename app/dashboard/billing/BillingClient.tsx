'use client';

// Usage strip + three plan tiles. Upgrading fires a Checkout session; managing
// an existing sub opens the Customer Portal. Both are POSTs that return a URL
// we navigate to. Toasts on ?status=success / ?status=cancelled.

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Plan } from '@/lib/auth';
import type { PlanTier } from '@/lib/plan-limits';

export type BillingProfile = {
  plan: Plan;
  memoryCount: number;
  hasBilling: boolean;
  updatedAt: string | null;
};

export type BillingTile = { plan: Plan; tier: PlanTier };

export function BillingClient({
  profile,
  tiles,
}: {
  profile: BillingProfile;
  tiles: BillingTile[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'good' | 'bad'; msg: string } | null>(null);

  useEffect(() => {
    const status = params.get('status');
    if (status === 'success') {
      setToast({
        kind: 'good',
        msg: 'Subscription confirmed. Your plan will update within a moment.',
      });
    } else if (status === 'cancelled') {
      setToast({ kind: 'bad', msg: 'Checkout cancelled. No change to your plan.' });
    }
    if (status) {
      const t = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, [params]);

  const cap = tiles.find((t) => t.plan === profile.plan)?.tier.captureCap ?? 100;
  const unlimited = !Number.isFinite(cap);
  const pct = useMemo(() => {
    if (unlimited) return 0;
    return Math.min(100, Math.round((profile.memoryCount / cap) * 100));
  }, [profile.memoryCount, cap, unlimited]);

  async function upgrade(plan: Plan) {
    setBusyPlan(plan);
    try {
      const res = await fetch('/api/ls/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setToast({ kind: 'bad', msg: data.error ?? 'Could not start checkout.' });
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusyPlan(null);
    }
  }

  function openPortal() {
    window.location.href = '/api/ls/portal';
  }

  return (
    <div className="flex flex-col gap-12">
      {toast && (
        <div
          role="status"
          className={
            'rounded-xl border px-5 py-4 text-sm transition-opacity duration-500 ' +
            (toast.kind === 'good'
              ? 'border-amber/30 bg-amber/5 text-cream'
              : 'border-cream/15 bg-cream/5 text-cream/80')
          }
        >
          {toast.msg}
        </div>
      )}

      <div className="rounded-2xl border border-cream/10 bg-cream/[0.02] px-8 py-8">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-2">
              Current plan
            </p>
            <h2 className="font-serif text-4xl text-cream">
              {tiles.find((t) => t.plan === profile.plan)?.tier.name ?? 'Free'}
            </h2>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-1">
              Usage
            </p>
            <p className="font-serif text-2xl text-cream">
              {profile.memoryCount.toLocaleString()}
              <span className="text-cream/40 text-lg">
                {' '}
                / {unlimited ? '∞' : cap.toLocaleString()}
              </span>
            </p>
          </div>
        </div>

        {!unlimited && (
          <div className="h-1.5 rounded-full bg-cream/10 overflow-hidden mt-6">
            <div
              className="h-full bg-amber/70 transition-[width] duration-[600ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {profile.hasBilling && (
          <div className="mt-8">
            <button
              onClick={openPortal}
              disabled={portalBusy}
              className="font-mono text-[11px] uppercase tracking-widest text-cream/60 hover:text-amber transition-colors disabled:opacity-40"
            >
              {portalBusy ? 'Opening…' : 'Manage subscription in Stripe →'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {tiles.map(({ plan, tier }) => {
          const isCurrent = plan === profile.plan;
          const isDowngrade =
            (profile.plan === 'team' && (plan === 'pro' || plan === 'free')) ||
            (profile.plan === 'pro' && plan === 'free');
          const isFree = plan === 'free';
          const busy = busyPlan === plan;
          return (
            <div
              key={plan}
              className={
                'rounded-2xl border px-7 py-8 flex flex-col transition-colors duration-[480ms] ' +
                (isCurrent
                  ? 'border-amber/40 bg-amber/[0.04]'
                  : 'border-cream/10 bg-cream/[0.02] hover:border-cream/25')
              }
            >
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-3">
                {isCurrent ? 'Current' : tier.name}
              </p>
              <h3 className="font-serif text-3xl text-cream mb-2">{tier.name}</h3>
              <p className="text-cream/60 text-sm leading-relaxed mb-6">{tier.tagline}</p>
              <p className="font-serif text-4xl text-cream mb-1">
                {tier.priceMonthly === 0 ? 'Free' : `$${tier.priceMonthly}`}
                {tier.priceMonthly !== 0 && (
                  <span className="text-cream/40 text-base font-sans"> / month</span>
                )}
              </p>

              <ul className="mt-6 mb-8 flex flex-col gap-2 text-sm text-cream/70">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-3">
                    <span className="text-amber/70 mt-[0.4em] block w-1 h-1 rounded-full bg-amber/70" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto">
                {isCurrent ? (
                  <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
                    This is your plan.
                  </span>
                ) : isFree ? (
                  profile.hasBilling ? (
                    <button
                      onClick={openPortal}
                      disabled={portalBusy}
                      className="w-full rounded-lg border border-cream/20 py-3 font-sans font-medium text-sm text-cream hover:border-cream/40 transition-colors disabled:opacity-40"
                    >
                      {portalBusy ? 'Opening…' : 'Cancel in Stripe'}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
                      Default tier.
                    </span>
                  )
                ) : isDowngrade ? (
                  <button
                    onClick={openPortal}
                    disabled={portalBusy}
                    className="w-full rounded-lg border border-cream/20 py-3 font-sans font-medium text-sm text-cream hover:border-cream/40 transition-colors disabled:opacity-40"
                  >
                    {portalBusy ? 'Opening…' : 'Downgrade in Stripe'}
                  </button>
                ) : (
                  <button
                    onClick={() => upgrade(plan)}
                    disabled={busy}
                    className="w-full rounded-lg bg-amber text-night py-3 font-sans font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
                  >
                    {busy ? 'Redirecting…' : `Upgrade to ${tier.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-cream/40 text-sm max-w-xl leading-relaxed">
        Nothing is ever deleted when you downgrade. Your memories stay; only the cap on new ones
        changes. Cancel anytime from the Stripe portal.
      </p>

      <button
        onClick={() => router.refresh()}
        className="self-start font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-amber transition-colors"
      >
        Refresh usage
      </button>
    </div>
  );
}
