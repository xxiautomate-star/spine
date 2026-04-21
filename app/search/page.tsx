import { redirect } from 'next/navigation';
import { getServerUser } from '@/lib/supabase-server';
import { SearchClient } from './SearchClient';

export const metadata = { title: 'Search — Spine' };
export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const user = await getServerUser();
  if (!user) redirect('/login');
  return <SearchClient email={user.email ?? ''} />;
}
