// GET /api/memories/export
// Streams the signed-in user's full memory corpus as newline-delimited JSON.
// Query params mirror the dashboard filters so you can export exactly what
// you're looking at. include_embeddings=true opts into the 1536-dim vector
// column (off by default — embeddings are big and most people just want the
// content).

import { type NextRequest } from 'next/server';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 500;

function firstParam(url: URL, key: string): string | null {
  const v = url.searchParams.get(key);
  return v && v.length > 0 ? v : null;
}

export async function GET(req: NextRequest) {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const includeEmb = url.searchParams.get('include_embeddings') === 'true';
  const q = firstParam(url, 'q');
  const source = firstParam(url, 'source');
  const from = firstParam(url, 'from');
  const toRaw = firstParam(url, 'to');
  const tag = firstParam(url, 'tag');
  const to = toRaw && /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? `${toRaw}T23:59:59.999Z` : toRaw;

  const columns = includeEmb
    ? 'id, content, source, tags, created_at, embedding'
    : 'id, content, source, tags, created_at';

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `spine-memories-${stamp}.jsonl`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let offset = 0;
      let more = true;
      try {
        while (more) {
          let query = supabase
            .from('memories')
            .select(columns)
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(offset, offset + PAGE - 1);
          if (source) query = query.eq('source', source);
          if (from) query = query.gte('created_at', from);
          if (to) query = query.lte('created_at', to);
          if (tag) query = query.contains('tags', [tag]);
          if (q)
            query = query.textSearch('content_tsv', q, {
              type: 'websearch',
              config: 'english',
            });

          const { data, error } = await query;
          if (error) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ _error: error.message }) + '\n')
            );
            break;
          }
          const rows = (data ?? []) as unknown as Record<string, unknown>[];
          for (const row of rows) {
            controller.enqueue(encoder.encode(JSON.stringify(row) + '\n'));
          }
          more = rows.length === PAGE;
          offset += rows.length;
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
