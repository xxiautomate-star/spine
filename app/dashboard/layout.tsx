import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { UpgradeOverlay } from '@/components/UpgradeOverlay';
import { DashboardNav } from '@/components/DashboardNav';
import { OnboardingBanner } from '@/components/OnboardingBanner';

export const dynamic = 'force-dynamic';

const FIRST_DAY_MS = 24 * 60 * 60 * 1000;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured()) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-4">
            Not configured
          </p>
          <h1 className="font-serif text-4xl text-cream mb-4">Dashboard offline.</h1>
          <p className="text-cream/60 leading-relaxed">
            This deployment has no Supabase auth credentials. Set
            <code className="font-mono text-amber mx-1">NEXT_PUBLIC_SUPABASE_URL</code>
            and
            <code className="font-mono text-amber mx-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
            to bring the archive back online.
          </p>
        </div>
      </main>
    );
  }

  const user = await getServerUser();
  if (!user) redirect('/login');

  const email = user.email ?? 'anonymous';

  // Onboarding banner gate: render only for accounts < 24h old with zero
  // captured memories. Cheap count(*) using head:true so we don't pull rows.
  // If the table or query fails for any reason we fall back to NOT showing
  // the banner — the dashboard still works without it.
  const accountAgeMs = user.created_at
    ? Date.now() - new Date(user.created_at).getTime()
    : Number.POSITIVE_INFINITY;
  let showOnboardingBanner = false;
  if (accountAgeMs < FIRST_DAY_MS) {
    const sb = getSupabase();
    if (sb) {
      const { count } = await sb
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('deleted_at', null);
      showOnboardingBanner = (count ?? 0) === 0;
    }
  }

  // Email + signout form rendered server-side and passed into the client
  // nav via the `tail` slot. Keeps the form's POST action in the static
  // markup so it works without JavaScript.
  const tail = (
    <span className="flex items-center gap-4">
      <span className="hidden md:inline text-cream/30 font-mono text-[11px]">{email}</span>
      <span className="md:hidden block text-cream/30 font-mono text-[10px] truncate max-w-[200px]">{email}</span>
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="text-cream/40 hover:text-amber font-mono text-[11px] uppercase tracking-widest"
        >
          Sign out
        </button>
      </form>
    </span>
  );

  return (
    <div className="min-h-screen flex flex-col">
      <header className="fixed top-0 inset-x-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/5">
        <Link href="/" className="flex items-center gap-3 flex-shrink-0">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <DashboardNav tail={tail} />
      </header>
      <div className="flex-1 pt-[68px]">
        {showOnboardingBanner && <OnboardingBanner />}
        {children}
      </div>
      <UpgradeOverlay />
    </div>
  );
}
