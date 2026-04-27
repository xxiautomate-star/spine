// Forget is forget. The memory row is hard-deleted along with its embedding
// (vector column) and content_tsv (generated stored column). No undelete.
// This is the only path in the product that removes data — everything else is
// append-only.
//
// The audit row survives the delete (memory_audit.memory_id is intentionally
// NOT a foreign key) so a forensic question like "what happened to memory X?"
// is answerable even after the data itself is gone.

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { logAuditFireForget } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Capture the row's mime + source before delete so the audit entry has
  // useful context after the row is gone.
  const { data: prior } = await supabase
    .from('memories')
    .select('mime, source')
    .eq('user_id', auth.authed.userId)
    .eq('id', id)
    .maybeSingle();

  const { error, count } = await supabase
    .from('memories')
    .delete({ count: 'exact' })
    .eq('user_id', auth.authed.userId)
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const forgotten = (count ?? 0) > 0;
  if (forgotten) {
    logAuditFireForget({
      userId: auth.authed.userId,
      orgId: auth.authed.orgId ?? null,
      op: 'delete',
      memoryId: id,
      caller: auth.authed.keyId,
      mime: (prior?.mime as string | null) ?? null,
      metadata: { source: (prior?.source as string | null) ?? null },
    });
  }
  return NextResponse.json({ forgotten });
}
