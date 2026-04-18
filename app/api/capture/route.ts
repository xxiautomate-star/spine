import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { embedMany } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CaptureItem = {
  content?: unknown;
  source?: unknown;
  tags?: unknown;
};

type Body = CaptureItem & { bulk?: CaptureItem[] };

function coerceItem(item: CaptureItem): { content: string; source: string | null; tags: string[] | null } | null {
  if (typeof item.content !== 'string' || !item.content.trim()) return null;
  return {
    content: item.content,
    source: typeof item.source === 'string' ? item.source : null,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string')
      : null,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rawItems: CaptureItem[] = Array.isArray(body.bulk) ? body.bulk : [body];
  const items = rawItems.map(coerceItem);
  if (items.some((x) => x === null) || items.length === 0) {
    return NextResponse.json(
      { error: 'Each memory must include a non-empty content string.' },
      { status: 400 }
    );
  }
  const clean = items as NonNullable<(typeof items)[number]>[];

  let vectors: number[][];
  try {
    vectors = await embedMany(clean.map((c) => c.content));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  const rows = clean.map((c, i) => ({
    user_id: auth.authed.userId,
    content: c.content,
    source: c.source,
    tags: c.tags,
    embedding: vectors[i],
  }));

  const { data, error } = await supabase.from('memories').insert(rows).select('id');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const ids = (data ?? []).map((r) => r.id as string);
  return NextResponse.json(Array.isArray(body.bulk) ? { ids } : { id: ids[0] });
}
