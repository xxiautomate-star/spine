// Gate C — visual proof of memory.
//
// Two timestamps. Two snapshots. The diff between them. The page that
// makes Spine feel different in a 10-second screen capture: drag the
// slider, watch what your AI knew change.
//
// Server-side: just renders the auth shell. The slider + fetch + diff
// rendering all live in TimelineDiffClient — the slider needs to feel
// snappy, and going through the server on every drag would flash a
// loading state every time.

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerUser, isAuthConfigured } from '@/lib/supabase-server';
import { TimelineDiffClient } from './TimelineDiffClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Timeline diff — Spine',
  description: 'Drag the slider to see what Spine knew, then and now.',
};

export default async function TimelineDiffPage() {
  if (!isAuthConfigured()) redirect('/login');
  const user = await getServerUser();
  if (!user) redirect('/login');

  return <TimelineDiffClient />;
}
