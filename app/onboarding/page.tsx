import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { OnboardingClient } from './OnboardingClient';

export const metadata = { title: 'Getting started — Spine' };

export default async function OnboardingPage() {
  if (!isAuthConfigured()) redirect('/');
  const user = await getServerUser();
  if (!user) redirect('/login?next=/onboarding');

  return <OnboardingClient email={user.email ?? ''} />;
}
