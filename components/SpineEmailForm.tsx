'use client';

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'ok' | 'duplicate' | 'error';

export function SpineEmailForm({ source = 'labs-spine' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending' || !email.trim()) return;
    setStatus('sending');
    setErr(null);

    try {
      const res = await fetch('/api/spine-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; duplicate?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setStatus('error');
        setErr(data.error ?? 'Something went wrong. Try again.');
        return;
      }
      setStatus(data.duplicate ? 'duplicate' : 'ok');

      // Fire pixel + CAPI event. Server-relayed so the primary source of truth is first-party.
      try {
        if (typeof window !== 'undefined' && typeof (window as any).fbq === 'function') {
          (window as any).fbq('track', 'Lead', { content_name: 'spine-waitlist', source });
        }
        void fetch('/api/spine-events/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), source, event: 'spine_waitlist_signup' }),
        }).catch(() => {});
      } catch {
        // analytics is never a blocking concern
      }
    } catch {
      setStatus('error');
      setErr('Network error. Try again in a moment.');
    }
  }

  if (status === 'ok' || status === 'duplicate') {
    return (
      <div className="py-2">
        <p className="font-serif text-2xl md:text-3xl text-cream">
          {status === 'duplicate' ? 'You’re already on the list.' : 'You’re on the list.'}
        </p>
        <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-cream/45">
          We’ll write when there’s a seat, and only then.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3" noValidate>
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@domain.com"
        aria-label="Email for Spine waitlist"
        className="flex-1 bg-transparent border-b border-cream/25 focus:border-amber focus:outline-none py-3 px-1 text-lg placeholder:text-cream/25 transition-colors duration-500"
      />
      <button
        type="submit"
        disabled={status === 'sending'}
        className="group inline-flex items-center justify-center gap-3 px-6 py-3 bg-amber text-night hover:bg-cream disabled:opacity-60 disabled:hover:bg-amber transition-colors duration-500"
      >
        <span className="font-serif text-lg">
          {status === 'sending' ? 'Sending…' : 'Request a seat'}
        </span>
        <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono">→</span>
      </button>
      {status === 'error' && err && (
        <p className="sr-only" role="alert">
          {err}
        </p>
      )}
      {status === 'error' && err && (
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber/80 self-center">
          {err}
        </p>
      )}
    </form>
  );
}
