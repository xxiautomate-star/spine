'use client';

import { useState, useEffect } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

type Props = {
  prefillEmail?: string;
  inviteCode?: string;
};

export function LoginClient({ prefillEmail, inviteCode }: Props) {
  const [email, setEmail] = useState(prefillEmail ?? '');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);

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

  async function handleGithub() {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setErrorMsg('Auth is not configured.');
      return;
    }
    setGithubBusy(true);
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
    });
    if (error) {
      setGithubBusy(false);
      setErrorMsg(error.message);
    }
  }

  return (
    <div className="space-y-8">
      <button
        onClick={handleGithub}
        disabled={githubBusy}
        className="w-full border border-cream/20 hover:border-cream/40 px-5 py-4 text-left font-mono text-[12px] uppercase tracking-widest text-cream/80 transition-colors disabled:opacity-40"
      >
        {githubBusy ? 'Opening GitHub…' : 'Continue with GitHub'}
      </button>

      <div className="flex items-center gap-4">
        <span className="flex-1 h-px bg-cream/10" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30">or</span>
        <span className="flex-1 h-px bg-cream/10" />
      </div>

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
      </form>
    </div>
  );
}
