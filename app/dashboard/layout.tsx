import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="fixed top-0 inset-x-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/5">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <nav className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-widest">
          <Link href="/dashboard/memories" className="text-cream/60 hover:text-cream">
            Archive
          </Link>
          <Link href="/dashboard/recall" className="text-cream/60 hover:text-cream">
            Recall
          </Link>
          <Link href="/dashboard/keys" className="text-cream/60 hover:text-cream">
            Keys
          </Link>
          <span className="hidden md:inline text-cream/30">{email}</span>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-cream/40 hover:text-amber">
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <div className="flex-1 pt-[68px]">{children}</div>
    </div>
  );
}
