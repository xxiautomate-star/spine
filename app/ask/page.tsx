import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { AskClient } from './AskClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Ask — Spine',
  description: 'Search every memory across every AI you have ever used.',
};

export default async function AskPage() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');
  return <AskClient email={user.email ?? ''} />;
}
