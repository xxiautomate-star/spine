import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ code?: string }>;

export default async function AfterInvitePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const code = params.code?.trim() ?? '';

  const user = await getServerUser();
  if (!user) {
    redirect(`/login?invite=${encodeURIComponent(code)}`);
  }

  const supabase = getSupabase();
  let outcome: 'success' | 'used' | 'expired' | 'email_mismatch' | 'unknown' | 'error' = 'success';
  let plan: string | null = null;

  if (!code || !supabase) {
    outcome = 'error';
  } else {
    const { data: invite } = await supabase
      .from('invite_codes')
      .select('code, email, plan_grant, expires_at, redeemed_at')
      .eq('code', code)
      .maybeSingle();

    if (!invite) {
      outcome = 'unknown';
    } else if (invite.redeemed_at) {
      outcome = 'used';
    } else if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
      outcome = 'expired';
    } else if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
      outcome = 'email_mismatch';
    } else {
      const { error: redeemErr } = await supabase
        .from('invite_codes')
        .update({ redeemed_by: user.id, redeemed_at: new Date().toISOString() })
        .eq('code', code)
        .is('redeemed_at', null);
      if (redeemErr) {
        outcome = 'error';
      } else {
        plan = invite.plan_grant;
        await supabase.from('profiles').upsert(
          { user_id: user.id, plan: invite.plan_grant, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
      }
    }
  }

  return (
    <main className="min-h-screen bg-night text-cream flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {outcome === 'success' && (
          <>
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-4">
              § Redeemed · {plan?.toUpperCase()} seat
            </p>
            <h1 className="font-serif text-5xl text-cream leading-tight mb-5">
              You’re in.
            </h1>
            <p className="text-cream/60 leading-relaxed mb-8">
              Your workspace is live on the <em className="italic text-amber">{plan}</em> plan. Start by
              minting an API key and wiring the MCP install command into Claude Code.
            </p>
            <div className="flex gap-4 flex-wrap">
              <Link
                href="/dashboard/keys"
                className="px-6 py-3 bg-amber text-night font-mono text-[11px] uppercase tracking-widest hover:bg-cream transition-colors"
              >
                Mint an API key →
              </Link>
              <Link
                href="/docs/mcp"
                className="px-6 py-3 border border-cream/20 hover:border-cream/50 text-cream/80 font-mono text-[11px] uppercase tracking-widest transition-colors"
              >
                Read the docs
              </Link>
            </div>
          </>
        )}

        {outcome !== 'success' && (
          <>
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-4">
              § Invite · {outcome}
            </p>
            <h1 className="font-serif text-4xl text-cream leading-tight mb-5">
              {headline(outcome)}
            </h1>
            <p className="text-cream/60 leading-relaxed mb-8">{explain(outcome)}</p>
            <div className="flex gap-4 flex-wrap">
              <Link
                href="/dashboard/keys"
                className="px-6 py-3 bg-amber text-night font-mono text-[11px] uppercase tracking-widest hover:bg-cream transition-colors"
              >
                Go to dashboard
              </Link>
              <Link
                href="/spine"
                className="px-6 py-3 border border-cream/20 hover:border-cream/50 text-cream/80 font-mono text-[11px] uppercase tracking-widest transition-colors"
              >
                Back to Spine
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function headline(outcome: string): string {
  switch (outcome) {
    case 'used':
      return 'That invite has already been redeemed.';
    case 'expired':
      return 'That invite has expired.';
    case 'email_mismatch':
      return 'Wrong account for this invite.';
    case 'unknown':
      return 'We don’t recognise that invite.';
    default:
      return 'Something went sideways redeeming that invite.';
  }
}

function explain(outcome: string): string {
  switch (outcome) {
    case 'used':
      return 'It can only be claimed once. You’re already signed in — use your dashboard.';
    case 'expired':
      return 'Invites are good for 30 days. Reply to our email and we’ll reissue.';
    case 'email_mismatch':
      return 'This invite was issued to a different email. Sign out and sign in with the invited address.';
    case 'unknown':
      return 'Double-check the code in your email — sometimes the link wraps.';
    default:
      return 'No changes were made to your account. Try again from the invite email or contact us.';
  }
}
