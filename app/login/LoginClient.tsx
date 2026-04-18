'use client';

import { useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase-browser';

export function LoginClient() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);

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
      options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard/keys` },
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
      options: { redirectTo: `${origin}/auth/callback?next=/dashboard/keys` },
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
          className="w-full bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-3 text-lg placeholder:text-cream/25"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full bg-amber text-night font-mono text-[12px] uppercase tracking-widest px-5 py-4 transition-opacity disabled:opacity-50"
        >
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Link sent — check your inbox' : 'Email me a link'}
        </button>
        {status === 'error' && errorMsg && (
          <p className="font-mono text-[11px] text-amber">{errorMsg}</p>
        )}
      </form>
    </div>
  );
}
