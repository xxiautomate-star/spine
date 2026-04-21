import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { ReplayClient } from './ReplayClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Spine Replay — Decision trail for any file',
  description: 'Reconstruct the full decision history behind any file in your codebase.',
};

export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const initialPath = typeof params.path === 'string' ? params.path : '';

  return <ReplayClient email={user.email ?? ''} initialPath={initialPath} />;
}
