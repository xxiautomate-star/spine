import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { getSupabase } from '@/lib/supabase';
import { AdminWaitlistClient } from './Client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Spine · admin · waitlist',
};

type WaitlistRow = {
  id: string;
  email: string;
  source: string | null;
  created_at: string;
};

type InviteRow = {
  code: string;
  email: string;
  issued_at: string;
  redeemed_at: string | null;
  plan_grant: string;
};

export default async function AdminWaitlistPage() {
  const admin = await requireAdmin();
  if (!admin) {
    redirect('/login?next=/admin/waitlist');
  }

  const supabase = getSupabase();
  let waitlist: WaitlistRow[] = [];
  let invites: InviteRow[] = [];
  let configured = true;

  if (supabase) {
    const [w, i] = await Promise.all([
      supabase
        .from('saas_spine_waitlist')
        .select('id, email, source, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('invite_codes')
        .select('code, email, issued_at, redeemed_at, plan_grant')
        .order('issued_at', { ascending: false })
        .limit(500),
    ]);
    waitlist = (w.data ?? []) as WaitlistRow[];
    invites = (i.data ?? []) as InviteRow[];
  } else {
    configured = false;
  }

  return (
    <main className="min-h-screen bg-night text-cream p-5 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-2">
              § Admin · waitlist
            </p>
            <h1 className="font-serif text-3xl md:text-5xl text-cream tracking-tight">
              Rolling access
            </h1>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              {waitlist.length} signups · {invites.length} invites issued ·{' '}
              {invites.filter((i) => i.redeemed_at).length} redeemed
            </p>
          </div>
          <Link
            href="/spine"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/40 hover:text-amber"
          >
            ← /spine
          </Link>
        </div>

        {!configured && (
          <p className="font-mono text-[11px] text-amber/80 mb-8">
            Supabase env vars missing — admin page rendered read-only.
          </p>
        )}

        <AdminWaitlistClient waitlist={waitlist} invites={invites} />
      </div>
    </main>
  );
}
