'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PLAN_LIMITS, type Plan } from '@/lib/plan-limits';

interface BillingData {
  plan: Plan;
  memory_count: number;
  memory_limit: number | null;
  org_name: string;
  ls_status: string | null;
  renews_at: string | null;
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (!limit) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between font-mono text-[10px]">
          <span className="text-cream/50">{used.toLocaleString()} memories</span>
          <span className="text-cream/25">unlimited</span>
        </div>
        <div className="h-1 bg-cream/[0.06] rounded-full">
          <div className="h-full w-full bg-amber/30 rounded-full" />
        </div>
      </div>
    );
  }

  const pct = Math.min((used / limit) * 100, 100);
  const nearCap = pct >= 80;
  const atCap = pct >= 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between font-mono text-[10px]">
        <span className={atCap ? 'text-red-400' : nearCap ? 'text-amber' : 'text-cream/50'}>
          {used.toLocaleString()} / {limit.toLocaleString()} memories
        </span>
        <span className={atCap ? 'text-red-400' : nearCap ? 'text-amber/70' : 'text-cream/25'}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-1.5 bg-cream/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            atCap ? 'bg-red-400' : nearCap ? 'bg-amber' : 'bg-amber/50'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {atCap && (
        <p className="font-mono text-[10px] text-red-400/80">
          Memory cap reached — upgrade to capture more.
        </p>
      )}
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<'pro' | 'team' | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    // Read URL params for post-checkout feedback
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (status === 'success') setStatusMsg('Payment successful — your plan will activate within seconds.');
    if (status === 'cancelled') setStatusMsg('Checkout cancelled.');

    fetch('/api/usage')
      .then((r) => r.json())
      .then((d: { count?: number; plan?: string; limit?: number }) => {
        setData({
          plan: (d.plan as Plan) ?? 'free',
          memory_count: d.count ?? 0,
          memory_limit: d.limit ?? PLAN_LIMITS['free'].captureCap,
          org_name: 'Personal workspace',
          ls_status: null,
          renews_at: null,
        });
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  async function startUpgrade(plan: 'pro' | 'team') {
    setUpgrading(plan);
    try {
      const res = await fetch('/api/ls/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (json.url) {
        window.location.href = json.url;
      } else {
        setStatusMsg(json.error ?? 'Checkout failed.');
        setUpgrading(null);
      }
    } catch {
      setStatusMsg('Network error — try again.');
      setUpgrading(null);
    }
  }

  const plan = data?.plan ?? 'free';
  const tier = PLAN_LIMITS[plan];

  return (
    <div className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-[#0D0C0A]/80 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-[#E89A3C]" />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <nav className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/timeline" className="text-cream/35 hover:text-cream/65 transition-colors">Timeline</Link>
          <Link href="/dashboard/keys" className="text-cream/35 hover:text-cream/65 transition-colors">API Keys</Link>
        </nav>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        {statusMsg && (
          <div className={`mb-8 px-4 py-3 rounded-lg font-mono text-[11px] border ${
            statusMsg.includes('success')
              ? 'bg-amber/[0.06] border-amber/20 text-amber/80'
              : 'bg-cream/[0.04] border-cream/[0.08] text-cream/50'
          }`}>
            {statusMsg}
          </div>
        )}

        <div className="mb-10">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-3">Billing</p>
          <h1 className="font-serif text-4xl text-cream">Your plan</h1>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 py-8">
            <div className="w-2 h-2 rounded-full bg-amber animate-pulse" />
            <span className="font-mono text-[11px] text-cream/30">Loading…</span>
          </div>
        ) : (
          <>
            {/* Current plan card */}
            <div className="border border-amber/20 rounded-2xl p-6 mb-8 bg-amber/[0.02]">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-widest text-cream/30 mb-1">Current plan</p>
                  <h2 className="font-serif text-3xl text-cream">{tier.name}</h2>
                  <p className="font-mono text-[11px] text-amber/60 mt-1">
                    {tier.priceMonthly === 0 ? 'Free' : `$${tier.priceMonthly}/mo`}
                  </p>
                </div>
                {plan !== 'free' && (
                  <a
                    href="/api/ls/portal"
                    className="font-mono text-[9px] uppercase tracking-widest text-cream/30 hover:text-cream/60 transition-colors border border-cream/[0.08] hover:border-cream/20 px-3 py-2 rounded-lg"
                  >
                    Manage →
                  </a>
                )}
              </div>

              <UsageBar
                used={data?.memory_count ?? 0}
                limit={Number.isFinite(tier.captureCap) ? tier.captureCap : null}
              />

              <ul className="mt-6 space-y-2">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-[13px] text-cream/55">
                    <span className="text-amber/50">—</span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Upgrade cards */}
            {plan === 'free' && (
              <div className="space-y-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-cream/25 mb-2">Upgrade</p>

                {(['pro', 'team'] as const).map((p) => {
                  const t = PLAN_LIMITS[p];
                  return (
                    <div key={p} className="border border-cream/[0.08] rounded-2xl p-6 hover:border-cream/[0.18] transition-colors duration-300">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-serif text-2xl text-cream">{t.name}</h3>
                          <p className="font-mono text-[11px] text-amber/60 mt-0.5">${t.priceMonthly}/mo</p>
                          <p className="text-[13px] text-cream/40 italic font-serif mt-1">{t.tagline}</p>
                        </div>
                        <button
                          disabled={upgrading === p}
                          onClick={() => startUpgrade(p)}
                          className="flex-shrink-0 px-5 py-2.5 bg-amber text-night font-mono text-[10px] uppercase tracking-widest hover:bg-cream transition-colors duration-300 rounded-lg disabled:opacity-50"
                        >
                          {upgrading === p ? 'Loading…' : `Start ${t.name} →`}
                        </button>
                      </div>
                      <ul className="space-y-1.5">
                        {t.features.map((f) => (
                          <li key={f} className="flex items-center gap-2.5 text-[12px] text-cream/45">
                            <span className="text-amber/40">—</span>{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}

                <p className="font-mono text-[9px] text-cream/20 mt-4">
                  Cancel any time. No lock-in. Data export available on all plans.
                </p>
              </div>
            )}

            {plan === 'pro' && (
              <div className="border border-cream/[0.08] rounded-2xl p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-serif text-2xl text-cream">Team</h3>
                    <p className="font-mono text-[11px] text-amber/60 mt-0.5">$59/mo · 5 seats</p>
                    <p className="text-[13px] text-cream/40 italic font-serif mt-1">Shared memory. Collective clarity.</p>
                  </div>
                  <button
                    disabled={upgrading === 'team'}
                    onClick={() => startUpgrade('team')}
                    className="flex-shrink-0 px-5 py-2.5 bg-amber text-night font-mono text-[10px] uppercase tracking-widest hover:bg-cream transition-colors duration-300 rounded-lg disabled:opacity-50"
                  >
                    {upgrading === 'team' ? 'Loading…' : 'Upgrade →'}
                  </button>
                </div>
                <ul className="space-y-1.5">
                  {PLAN_LIMITS.team.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-[12px] text-cream/45">
                      <span className="text-amber/40">—</span>{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
