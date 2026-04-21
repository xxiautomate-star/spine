// Server component: reads the signed-in user's profile + live memory count,
// passes them to the client for rendering. Checkout + portal go to LemonSqueezy.

import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { PLAN_LIMITS } from '@/lib/plan-limits';
import type { Plan } from '@/lib/auth';
import { BillingClient, type BillingProfile } from './BillingClient';

export const dynamic = 'force-dynamic';

async function fetchProfile(): Promise<BillingProfile> {
  const fallback: BillingProfile = {
    plan: 'free',
    memoryCount: 0,
    hasBilling: false,
    updatedAt: null,
  };
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) return fallback;

  const [{ data: profile }, { count }, { data: org }] = await Promise.all([
    supabase
      .from('profiles')
      .select('plan, plan_updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null),
    supabase
      .from('orgs')
      .select('ls_customer_id')
      .eq('owner_id', user.id)
      .not('ls_customer_id', 'is', null)
      .limit(1)
      .maybeSingle(),
  ]);

  const plan = coercePlan(profile?.plan);
  return {
    plan,
    memoryCount: count ?? 0,
    hasBilling: plan !== 'free' || !!org?.ls_customer_id,
    updatedAt: (profile?.plan_updated_at as string | null) ?? null,
  };
}

function coercePlan(raw: unknown): Plan {
  return raw === 'pro' || raw === 'team' ? raw : 'free';
}

export default async function BillingPage() {
  const profile = await fetchProfile();
  const plans: Plan[] = ['free', 'pro', 'team'];
  const tiles = plans.map((p) => ({ plan: p, tier: PLAN_LIMITS[p] }));

  return (
    <main>
      <section className="px-6 md:px-16 pt-24 pb-24">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 004 &middot; Billing
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Your plan.
          </h1>
          <p className="text-cream/60 text-lg max-w-2xl leading-relaxed mb-16">
            Your memories stay forever, on every plan. The tier you pick only decides how many
            new ones Spine will accept each month and how cleverly it reranks them for you.
          </p>

          <BillingClient profile={profile} tiles={tiles} />
        </div>
      </section>
    </main>
  );
}
