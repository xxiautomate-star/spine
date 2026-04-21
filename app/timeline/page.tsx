import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSupabase, getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { TimelineClient, type MemoryRow } from './TimelineClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Timeline — Spine',
  description: 'Your complete memory archive.',
};

async function fetchMemories(userId: string): Promise<MemoryRow[]> {
  const supabase = await getServerSupabase();
  if (!supabase) return [];

  const { data } = await supabase
    .from('memories')
    .select('id, content, source, tags, type, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(300);

  return (data ?? []) as MemoryRow[];
}

export default async function TimelinePage() {
  if (!isAuthConfigured()) redirect('/login');

  const user = await getServerUser();
  if (!user) redirect('/login');

  const memories = await fetchMemories(user.id);

  return <TimelineClient memories={memories} email={user.email ?? ''} />;
}
