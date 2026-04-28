'use client';

import { useState, useEffect } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

// Magic-link only auth.
//
// We dropped OAuth (signInWithOAuth) for the v2 launch. Reason: a
// self-hosted GoTrue requires per-provider config (GitHub OAuth app,
// callback URLs, client secrets) that is its own setup story. Magic-link
// only needs SMTP, which we already wire via Resend in production.
// OAuth comes back as a deliberate Pro-tier feature later — not as
// latent code that ships before the configuration to support it does.
//
// `/auth/callback` (GET) handles `exchangeCodeForSession` which works
// for both OTP and OAuth flows — leaving the callback intact means the
// future OAuth re-add is a one-component change here, not a route change.

type Props = {
  prefillEmail?: string;
  inviteCode?: string;
};

export function LoginClient({ prefillEmail, inviteCode }: Props) {
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // Stash invite code so it survives the magic-link round-trip.
    if (inviteCode && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('spine_invite_code', inviteCode);
      } catch {
        // private mode, etc. — harmless
      }
    }
  }, [inviteCode]);

  const nextPath = inviteCode
    ? `/auth/after-invite?code=${encodeURIComponent(inviteCode)}`
    : '/dashboard/keys';

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setStatus('error');
      setErrorMsg('Auth is not configured.');
      return;
    }
    setStatus('sending');
    setErrorMsg(null);
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
    });
    if (error) {
      setStatus('error');
      setErrorMsg(error.message);
      return;
    }
    setStatus('sent');
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleMagicLink} className="space-y-4">
        <label htmlFor="email" className="block font-mono text-[11px] uppercase tracking-widest text-cream/40">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@somewhere.com"
          readOnly={Boolean(inviteCode && prefillEmail)}
          className="w-full bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-3 text-lg placeholder:text-cream/25 read-only:text-cream/70"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full bg-amber text-night font-mono text-[12px] uppercase tracking-widest px-5 py-4 transition-opacity disabled:opacity-50"
        >
          {status === 'sending'
            ? 'Sending…'
            : status === 'sent'
            ? 'Link sent — check your inbox'
            : inviteCode
            ? 'Claim my seat'
            : 'Email me a link'}
        </button>
        {status === 'error' && errorMsg && (
          <p className="font-mono text-[11px] text-amber">{errorMsg}</p>
        )}
        {status === 'sent' && (
          <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
            Link is good for one hour. Click it from any browser — you&apos;ll land
            in your dashboard signed in.
          </p>
        )}
      </form>

      <p className="font-mono text-[10px] text-cream/25 leading-relaxed">
        Spine uses one-time email links. No passwords to remember, nothing to
        leak. We never sell your address; the only emails you get are
        sign-in links and the weekly retention digest you can disable in
        settings.
      </p>
    </div>
  );
}
