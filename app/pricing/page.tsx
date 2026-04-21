import type { Metadata } from 'next';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { PricingClient } from './PricingClient';

export const metadata: Metadata = {
  title: 'Pricing — Spine',
  description: 'Simple, honest pricing for a memory that lasts.',
};

export default async function PricingPage() {
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (isAuthConfigured()) {
    try {
      const user = await getServerUser();
      userId = user?.id ?? null;
      userEmail = user?.email ?? null;
    } catch {
      // unauthenticated visitors — fall through
    }
  }
  return <PricingClient userId={userId} userEmail={userEmail} />;
}
