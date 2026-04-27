import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { LoginClient } from './LoginClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  error?: string;
  sent?: string;
  invite?: string;
  email?: string;
  next?: string;
  signup?: string;
  plan?: string;
}>;

type InviteStatus =
  | { ok: true; email: string; plan: string; code: string }
  | { ok: false; reason: string }
  | null;

async function validateInvite(code: string, email: string | undefined): Promise<InviteStatus> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, reason: 'not_configured' };

  const { data } = await supabase
    .from('invite_codes')
    .select('code, email, plan_grant, expires_at, redeemed_at')
    .eq('code', code)
    .maybeSingle();

  if (!data) return { ok: false, reason: 'unknown' };
  if (data.redeemed_at) return { ok: false, reason: 'used' };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (email && data.email.toLowerCase() !== email.toLowerCase()) {
    return { ok: false, reason: 'email_mismatch' };
  }
  return { ok: true, email: data.email, plan: data.plan_grant, code: data.code };
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const configured = isAuthConfigured();

  let invite: InviteStatus = null;
  if (params.invite) {
    invite = await validateInvite(params.invite, params.email);
  }

  if (configured) {
    const user = await getServerUser();
    if (user) {
      // Already signed in. If we came with a valid invite, go redeem it. Else dashboard.
      if (invite && invite.ok) {
        redirect(`/auth/after-invite?code=${encodeURIComponent(invite.code)}`);
      }
      redirect(params.next ?? '/dashboard/keys');
    }
  }

  const prefillEmail = invite && invite.ok ? invite.email : params.email ?? '';

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 md:px-10 py-5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <Link href="/" className="font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-cream/70">
          Back
        </Link>
      </header>

      <section className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {invite && invite.ok ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
                § Rolling access · {invite.plan.toUpperCase()} seat
              </p>
              <h1 className="font-serif text-5xl md:text-6xl leading-[0.98] text-cream mb-5">
                Welcome in.
              </h1>
              <p className="text-cream/60 leading-relaxed mb-10">
                Your invite is valid. Sign in with {invite.email.replace(/(.{2}).+(@.+)/, '$1…$2')} to claim it.
              </p>
            </>
          ) : invite && !invite.ok ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
                § Invite · {invite.reason}
              </p>
              <h1 className="font-serif text-5xl md:text-6xl leading-[0.98] text-cream mb-5">
                That invite is {humanReason(invite.reason)}.
              </h1>
              <p className="text-cream/60 leading-relaxed mb-10">
                You can still sign in if you already have an account, or join the waitlist for a fresh invite.
              </p>
            </>
          ) : params.signup === '1' ? (
            <>
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
                § Spine &middot; First memory
              </p>
              <h1 className="font-serif text-5xl md:text-6xl leading-[0.98] text-cream mb-5">
                Welcome in.
              </h1>
              <p className="text-cream/60 leading-relaxed mb-10">
                Sign in with GitHub or your email — we&apos;ll send a link, no password. After that
                you&apos;ll mint an API key and the dashboard prints a one-line install command.
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
                § 002 &middot; Sign in
              </p>
              <h1 className="font-serif text-5xl md:text-6xl leading-[0.98] text-cream mb-5">
                Welcome back.
              </h1>
              <p className="text-cream/60 leading-relaxed mb-10">
                Your archive is waiting. Sign in to mint an API key or browse what your AI remembers.
              </p>
            </>
          )}

          {params.error && (
            <div className="mb-6 border border-amber/40 bg-amber/5 px-4 py-3 text-sm text-cream/80">
              {prettyError(params.error)}
            </div>
          )}
          {params.sent && (
            <div className="mb-6 border border-cream/20 bg-cream/[0.03] px-4 py-3 text-sm text-cream/80">
              Check your inbox — the link is good for one hour.
            </div>
          )}

          {configured ? (
            <LoginClient
              prefillEmail={prefillEmail}
              inviteCode={invite && invite.ok ? invite.code : undefined}
            />
          ) : (
            <div className="border border-cream/10 px-5 py-6 text-sm text-cream/60">
              Auth is not configured on this deployment yet. Set{' '}
              <code className="font-mono text-amber">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code className="font-mono text-amber">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sign-in.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function humanReason(reason: string): string {
  switch (reason) {
    case 'expired':
      return 'expired';
    case 'used':
      return 'already used';
    case 'email_mismatch':
      return 'for a different email';
    case 'unknown':
      return 'not recognised';
    default:
      return "not usable right now";
  }
}

function prettyError(code: string): string {
  switch (code) {
    case 'missing_code':
      return 'The sign-in link was incomplete. Try again.';
    case 'not_configured':
      return 'Auth is not configured on this deployment.';
    default:
      return decodeURIComponent(code);
  }
}
