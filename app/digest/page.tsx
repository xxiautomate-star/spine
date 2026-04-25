import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { DigestClient } from './DigestClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Daily Digest — Spine',
  description: 'Themes, decisions, and open questions from your AI conversations.',
};

export default async function DigestPage() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');
  return <DigestClient email={user.email ?? ''} />;
}
