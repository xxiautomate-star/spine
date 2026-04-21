import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { GraphClient } from './GraphClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Knowledge Graph — Spine',
  description: 'A force-directed graph of every entity your AI has touched.',
};

export default async function GraphPage() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');
  return <GraphClient email={user.email ?? ''} />;
}
