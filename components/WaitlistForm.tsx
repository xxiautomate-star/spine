'use client';

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'ok' | 'error';
type Tier = 'Free' | 'Pro' | 'Power' | 'Team';

const TIERS: Tier[] = ['Free', 'Pro', 'Power', 'Team'];

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<Tier>('Pro');
  const [useCase, setUseCase] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier_interest: tier, use_case: useCase }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus('error');
        setError(data.error ?? 'Something went wrong. Try again.');
        return;
      }
      setStatus('ok');
    } catch {
      setStatus('error');
      setError('Network error. Try again in a moment.');
    }
  }

  if (status === 'ok') {
    return (
      <div className="py-10">
        <p className="font-serif text-3xl md:text-4xl text-cream">You are on the list.</p>
        <p className="mt-4 text-cream/60 max-w-md">
          We will write when there is a seat — and only when there is something worth your attention.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      <div>
        <label htmlFor="email" className="block text-[11px] uppercase tracking-widest text-cream/50 font-mono mb-3">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@domain.com"
          className="w-full bg-transparent border-b border-cream/20 focus:border-amber focus:outline-none py-3 text-lg placeholder:text-cream/25 transition-colors duration-500"
        />
      </div>

      <div>
        <p className="block text-[11px] uppercase tracking-widest text-cream/50 font-mono mb-3">
          Tier you are after
        </p>
        <div className="flex flex-wrap gap-2">
          {TIERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              aria-pressed={tier === t}
              className={`px-4 py-2 text-sm border transition-colors duration-500 ${
                tier === t
                  ? 'border-amber text-amber'
                  : 'border-cream/20 text-cream/60 hover:border-cream/50 hover:text-cream'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="use_case" className="block text-[11px] uppercase tracking-widest text-cream/50 font-mono mb-3">
          What would you use it for?
        </label>
        <textarea
          id="use_case"
          name="use_case"
          rows={3}
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          placeholder="Optional, but it helps us build for you."
          maxLength={2000}
          className="w-full bg-transparent border-b border-cream/20 focus:border-amber focus:outline-none py-3 text-base resize-none placeholder:text-cream/25 transition-colors duration-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-6 pt-2">
        <button
          type="submit"
          disabled={status === 'sending'}
          className="group inline-flex items-center gap-3 px-6 py-3 bg-cream text-night hover:bg-amber disabled:opacity-60 disabled:hover:bg-cream transition-colors duration-500"
        >
          <span className="font-serif text-lg">
            {status === 'sending' ? 'Sending…' : 'Request access'}
          </span>
          <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
        </button>
        {error && <p className="text-sm text-amber/90">{error}</p>}
      </div>
    </form>
  );
}
