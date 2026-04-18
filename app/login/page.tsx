import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { LoginClient } from './LoginClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ error?: string; sent?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const configured = isAuthConfigured();

  if (configured) {
    const user = await getServerUser();
    if (user) redirect('/dashboard/keys');
  }

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
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
            § 002 &middot; Sign in
          </p>
          <h1 className="font-serif text-5xl md:text-6xl leading-[0.98] text-cream mb-5">
            Welcome back.
          </h1>
          <p className="text-cream/60 leading-relaxed mb-10">
            Your archive is waiting. Sign in to mint an API key or browse what your AI remembers.
          </p>

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
            <LoginClient />
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
