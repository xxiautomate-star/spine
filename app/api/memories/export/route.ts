// GET /api/memories/export
// Streams the signed-in user's full memory corpus as newline-delimited JSON.
// Query params mirror the dashboard filters so you can export exactly what
// you're looking at. include_embeddings=true opts into the 1536-dim vector
// column (off by default — embeddings are big and most people just want the
// content).
//
// SECURITY (2026-05-07): a session cookie with this scope can otherwise
// dump the entire user corpus in one GET. Rate-limited to 1 export per
// 60s per user, audit-logged to memory_audit on every call.

import { type NextRequest } from 'next/server';
import { getServerSupabase, getServerUser } from '@/lib/supabase-server';
import { logAuditFireForget } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 500;

// Per-user export throttle: 1 request / 60s. In-memory keyed by user_id —
// works for single-instance deploys; if Spine ever runs >1 replica, this
// should move to a shared store (Redis / Postgres advisory lock).
const lastExportAt = new Map<string, number>();
const EXPORT_WINDOW_MS = 60_000;

function checkExportRate(userId: string): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const prev = lastExportAt.get(userId) ?? 0;
  if (now - prev < EXPORT_WINDOW_MS) {
    return { ok: false, retryAfterMs: EXPORT_WINDOW_MS - (now - prev) };
  }
  lastExportAt.set(userId, now);
  // Cheap occasional GC so the map doesn't grow unbounded.
  if (lastExportAt.size > 5000) {
    const cutoff = now - EXPORT_WINDOW_MS;
    for (const [k, t] of lastExportAt) {
      if (t < cutoff) lastExportAt.delete(k);
    }
  }
  return { ok: true, retryAfterMs: 0 };
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

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

  // Throttle per-user — full-corpus exports are the single most damaging
  // exfil endpoint if a session cookie is ever stolen.
  const rate = checkExportRate(user.id);
  if (!rate.ok) {
    return new Response(
      JSON.stringify({
        error: 'Too many exports. Please wait before retrying.',
        retry_after_ms: rate.retryAfterMs,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)),
        },
      }
    );
  }

  const ip = clientIp(req);

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
      let totalRows = 0;
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
          totalRows += rows.length;
          more = rows.length === PAGE;
          offset += rows.length;
        }
      } finally {
        // Audit-log the export. memory_audit.op constraint allows only
        // read/write/embed/reembed/delete — using 'read' with metadata
        // marker. Adding 'export' to the constraint would need a migration.
        logAuditFireForget({
          userId: user.id,
          op: 'read',
          caller: 'memories/export',
          metadata: {
            export: true,
            row_count: totalRows,
            include_embeddings: includeEmb,
            ip,
            filters: {
              q: q ?? null,
              source: source ?? null,
              from: from ?? null,
              to: to ?? null,
              tag: tag ?? null,
            },
            // TODO: send confirmation email on large exports once Resend is
            // wired into the user-notification path. Track by user_id +
            // last_export_email_at on profiles.
          },
        });
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
