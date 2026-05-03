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
        <label
          htmlFor="email"
          className="block font-mono text-[11px] uppercase tracking-widest"
          style={{ color: 'var(--s-ink-faint)' }}
        >
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
          className="w-full bg-transparent focus:outline-none py-3 text-lg"
          style={{
            borderBottom: '1px solid var(--s-vein-strong)',
            color: 'var(--s-ink)',
          }}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full font-mono text-[12px] uppercase tracking-widest px-5 py-4 transition-all duration-300 disabled:opacity-50 rounded-md"
          style={{
            background: 'linear-gradient(180deg, #fdfaf2 0%, #f0e3c4 100%)',
            color: 'var(--s-ink-strong)',
            border: '1px solid var(--s-vein-strong)',
            boxShadow: '0 2px 6px rgba(60,45,20,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
            fontWeight: 600,
          }}
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
          <p className="font-mono text-[11px]" style={{ color: 'var(--s-amber-warm)' }}>{errorMsg}</p>
        )}
        {status === 'sent' && (
          <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>
            Link is good for one hour. Click it from any browser — you&apos;ll land
            in your dashboard signed in.
          </p>
        )}
      </form>

      <p className="font-mono text-[10px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>
        Spine uses one-time email links. No passwords to remember, nothing to
        leak. We never sell your address; the only emails you get are
        sign-in links and the weekly retention digest you can disable in
        settings.
      </p>
    </div>
  );
}
