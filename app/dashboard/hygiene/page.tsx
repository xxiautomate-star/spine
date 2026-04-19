// Server component: renders three hygiene surfaces — clusters overview,
// unresolved duplicate pairs, stale cleanup candidates. Free plans see
// read-only insights; Pro/Power get the action buttons (scan, merge, delete).

import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import type { Plan } from '@/lib/auth';
import {
  listClusters,
  listStaleMemories,
  listUnresolvedDuplicates,
  type ClusterSummary,
  type DuplicatePair,
  type StaleMemory,
} from '@/lib/hygiene';
import { HygieneClient } from './HygieneClient';

export const dynamic = 'force-dynamic';

type PageData = {
  plan: Plan;
  clusters: ClusterSummary[];
  duplicates: DuplicatePair[];
  stale: StaleMemory[];
  totalMemories: number;
};

function coercePlan(raw: unknown): Plan {
  return raw === 'pro' || raw === 'power' ? raw : 'free';
}

async function fetchHygiene(): Promise<PageData> {
  const empty: PageData = {
    plan: 'free',
    clusters: [],
    duplicates: [],
    stale: [],
    totalMemories: 0,
  };
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) return empty;

  const admin = getSupabase();
  if (!admin) return empty;

  const [{ data: profile }, { count }, clusters, duplicates, stale] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null),
    listClusters(admin, user.id, 12),
    listUnresolvedDuplicates(admin, user.id, 25),
    listStaleMemories(admin, user.id, 50),
  ]);

  return {
    plan: coercePlan(profile?.plan),
    clusters,
    duplicates,
    stale,
    totalMemories: count ?? 0,
  };
}

export default async function HygienePage() {
  const data = await fetchHygiene();

  return (
    <main>
      <section className="px-6 md:px-16 pt-24 pb-24">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 005 &middot; Hygiene
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Tend the archive.
          </h1>
          <p className="text-cream/60 text-lg max-w-2xl leading-relaxed mb-16">
            Spine never deletes on your behalf. But it can notice: clusters forming around your
            recurring topics, possible duplicates when you capture the same idea twice, memories
            that have sat untouched for months. Everything on this page is a suggestion, not an
            action — you decide what stays.
          </p>

          <HygieneClient data={data} />
        </div>
      </section>
    </main>
  );
}
