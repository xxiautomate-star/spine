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

  // Treat plan-aware arrivals as signup mode. Pricing-page CTAs route here
  // with `?plan=pro` (or `?next=/pricing?upgrade=...`); rendering "Welcome
  // back." in those cases mis-reads obvious signup intent.
  const isSignup =
    params.signup === '1' ||
    !!params.plan ||
    (typeof params.next === 'string' && params.next.startsWith('/pricing'));
  const planLabel = params.plan
    ? params.plan.charAt(0).toUpperCase() + params.plan.slice(1)
    : null;

  return (
    <main
      className="relative marble-bg min-h-screen flex flex-col overflow-x-hidden"
      style={{ color: 'var(--s-ink)' }}
    >
      {/* Marble texture overlays */}
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />

      {/* Gold-foil top edge */}
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <header
        className="relative px-6 md:px-10 py-5 flex items-center justify-between"
        style={{ zIndex: 10, borderBottom: '1px solid var(--s-vein)' }}
      >
        <Link href="/" className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
            <defs>
              <linearGradient id="spineLoginGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8c769" />
                <stop offset="55%" stopColor="#b8924a" />
                <stop offset="100%" stopColor="#7a5f2a" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="14.5" stroke="url(#spineLoginGold)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
            <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spineLoginGold)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
          <span className="font-serif text-xl" style={{ color: 'var(--s-ink)' }}>Spine</span>
        </Link>
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-widest transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
          style={{ color: 'var(--s-ink-faint)' }}
        >
          Back
        </Link>
      </header>

      <section className="relative flex-1 flex items-center justify-center px-6 py-16" style={{ zIndex: 1 }}>
        <div className="w-full max-w-md rise rise-1">
          {invite && invite.ok ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
                <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§</span>
                Rolling access · {invite.plan.toUpperCase()} seat
              </p>
              <h1
                className="font-serif text-5xl md:text-6xl leading-[0.98] tracking-[-0.025em] mb-5"
                style={{ color: 'var(--s-ink)' }}
              >
                Welcome <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>in.</em>
              </h1>
              <p className="leading-relaxed mb-10" style={{ color: 'var(--s-ink-soft)' }}>
                Your invite is valid. Sign in with {invite.email.replace(/(.{2}).+(@.+)/, '$1…$2')} to claim it.
              </p>
            </>
          ) : invite && !invite.ok ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
                <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§</span>
                Invite · {invite.reason}
              </p>
              <h1
                className="font-serif text-5xl md:text-6xl leading-[0.98] tracking-[-0.025em] mb-5"
                style={{ color: 'var(--s-ink)' }}
              >
                That invite is{' '}
                <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>{humanReason(invite.reason)}.</em>
              </h1>
              <p className="leading-relaxed mb-10" style={{ color: 'var(--s-ink-soft)' }}>
                You can still sign in if you already have an account, or join the waitlist for a fresh invite.
              </p>
            </>
          ) : isSignup ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
                <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
                {planLabel ? `Spine · Starting ${planLabel}` : 'Spine · First memory'}
              </p>
              <h1
                className="font-serif text-5xl md:text-6xl leading-[0.98] tracking-[-0.025em] mb-5"
                style={{ color: 'var(--s-ink)' }}
              >
                Welcome <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>in.</em>
              </h1>
              <p className="leading-relaxed mb-10" style={{ color: 'var(--s-ink-soft)' }}>
                {planLabel === 'Pro'
                  ? 'Starting on Pro · $19/month. Enter your email — we’ll send a one-time sign-in link, then drop you into checkout.'
                  : planLabel === 'Team'
                    ? 'Starting on Team · $59/month for 5 seats. Enter your email — we’ll send a one-time sign-in link, then drop you into checkout.'
                    : 'Enter your email — we’ll send a one-time sign-in link, no password. After that you’ll mint an API key and the dashboard prints a one-line install command.'}
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
                <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 002</span>
                Sign in
              </p>
              <h1
                className="font-serif text-5xl md:text-6xl leading-[0.98] tracking-[-0.025em] mb-5"
                style={{ color: 'var(--s-ink)' }}
              >
                Welcome <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>back.</em>
              </h1>
              <p className="leading-relaxed mb-10" style={{ color: 'var(--s-ink-soft)' }}>
                Your archive is waiting. Sign in to mint an API key or browse what your AI remembers.
              </p>
            </>
          )}

          {params.error && (
            <div
              className="mb-6 px-4 py-3 text-sm rounded-md"
              style={{
                border: '1px solid var(--s-vein-strong)',
                background: 'rgba(201, 125, 59, 0.08)',
                color: 'var(--s-ink-strong)',
              }}
            >
              {prettyError(params.error)}
            </div>
          )}
          {params.sent && (
            <div
              className="mb-6 px-4 py-3 text-sm rounded-md"
              style={{
                border: '1px solid var(--s-vein)',
                background: 'rgba(255, 253, 247, 0.65)',
                color: 'var(--s-ink-strong)',
              }}
            >
              Check your inbox — the link is good for one hour.
            </div>
          )}

          {configured ? (
            <LoginClient
              prefillEmail={prefillEmail}
              inviteCode={invite && invite.ok ? invite.code : undefined}
            />
          ) : (
            <div
              className="px-5 py-6 text-sm rounded-md"
              style={{
                border: '1px solid var(--s-vein)',
                background: 'rgba(255, 253, 247, 0.65)',
                color: 'var(--s-ink-soft)',
              }}
            >
              Auth is not configured on this deployment yet. Set{' '}
              <code className="font-mono" style={{ color: 'var(--s-gold-deep)' }}>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code className="font-mono" style={{ color: 'var(--s-gold-deep)' }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sign-in.
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
