// GET /api/ls/portal — redirect to LemonSqueezy customer portal

import { NextResponse } from 'next/server';
import { getServerUser } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { getPortalUrl } from '@/lib/lemonsqueezy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getServerUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const { data: org } = await sb
    .from('orgs')
    .select('ls_customer_id')
    .eq('owner_id', user.id)
    .not('ls_customer_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!org?.ls_customer_id)
    return NextResponse.json({ error: 'No billing account found.' }, { status: 404 });

  const url = await getPortalUrl(org.ls_customer_id as string);
  if (!url) return NextResponse.json({ error: 'Could not get portal URL.' }, { status: 500 });

  return NextResponse.redirect(url);
}
