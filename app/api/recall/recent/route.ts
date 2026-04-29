import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

type Body = {
  namespace?: unknown;
  max_tokens?: unknown;
};

type DigestRow = {
  id: string;
  content: string;
  session_id: string | null;
  created_at: string;
};

type TurnRow = {
  id: string;
  content: string;
  session_id: string | null;
  source: string | null;
  tool_name: string | null;
  created_at: string;
};

const DEFAULT_MAX_TOKENS = 2000;
const MIN_TOKENS = 200;
const MAX_TOKENS = 32000;
const CHARS_PER_TOKEN = 4;
const MAX_DIGESTS = 3;
const MAX_TURNS = 50;

// Budget overhead for headers, separators, and the truncation footer line.
const FRAMING_CHAR_OVERHEAD = 200;

function formatDigestLine(d: DigestRow): string {
  const date = d.created_at.slice(0, 10);
  const session = d.session_id ? d.session_id.slice(0, 8) : 'unknown';
  return `[${date} · session ${session}]\n${d.content}`;
}

function formatTurnLine(t: TurnRow): string {
  const time = t.created_at.slice(11, 16);
  // Content is stored prefixed with [role] by the capture-turn CLI; keep
  // that prefix and just add the timestamp + tool tag in front.
  const tool = t.tool_name ? ` (tool: ${t.tool_name})` : '';
  return `${time}${tool} ${t.content}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed) {
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Empty body is fine — defaults apply.
  }

  const requestedTokens =
    typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens)
      ? Math.floor(body.max_tokens)
      : DEFAULT_MAX_TOKENS;
  const maxTokens = Math.max(MIN_TOKENS, Math.min(MAX_TOKENS, requestedTokens));
  const charBudget = maxTokens * CHARS_PER_TOKEN - FRAMING_CHAR_OVERHEAD;

  const supabase = getSupabase();
  if (!supabase) {
    return withCors(
      NextResponse.json({ error: 'Server not configured.' }, { status: 500 })
    );
  }

  // 1. Pull the most recent N digests for this user.
  const { data: digests, error: dErr } = await supabase
    .from('memories')
    .select('id, content, session_id, created_at')
    .eq('user_id', auth.authed.userId)
    .eq('kind', 'digest')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_DIGESTS);
  if (dErr) {
    return withCors(NextResponse.json({ error: dErr.message }, { status: 500 }));
  }
  const digestRows = (digests ?? []) as DigestRow[];

  // 2. Find the single most-recent session id (turns OR digest — whichever
  //    is newest).
  const { data: latestRow } = await supabase
    .from('memories')
    .select('session_id')
    .eq('user_id', auth.authed.userId)
    .not('session_id', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestSessionId = (latestRow?.session_id as string | null) ?? null;

  // 3. Pull the last N turns of that session.
  let turnRows: TurnRow[] = [];
  if (latestSessionId) {
    const { data: turns, error: tErr } = await supabase
      .from('memories')
      .select('id, content, session_id, source, tool_name, created_at')
      .eq('user_id', auth.authed.userId)
      .eq('session_id', latestSessionId)
      .eq('kind', 'turn')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(MAX_TURNS);
    if (tErr) {
      return withCors(NextResponse.json({ error: tErr.message }, { status: 500 }));
    }
    turnRows = (turns ?? []) as TurnRow[];
  }

  // 4. Build the context block. Digests are mandatory — they fit in full or
  //    we surface a truncation footer; we never silently drop a digest.
  //    Turns fill remaining budget reverse-chronologically.
  const sectionLines: string[] = [];
  let used = 0;
  const includedSessionIds = new Set<string>();

  if (digestRows.length > 0) {
    sectionLines.push('## Recent session digests', '');
    let digestsKept = 0;
    for (const d of digestRows) {
      const line = `- ${formatDigestLine(d)}`;
      const cost = line.length + 2; // newline padding
      if (used + cost > charBudget && digestsKept > 0) {
        const remaining = digestRows.length - digestsKept;
        sectionLines.push(
          `- [${remaining} more digest${remaining === 1 ? '' : 's'} truncated, query timeline for full]`
        );
        used += 80;
        break;
      }
      sectionLines.push(line);
      used += cost;
      digestsKept += 1;
      if (d.session_id) includedSessionIds.add(d.session_id);
    }
    sectionLines.push('');
  }

  if (latestSessionId && turnRows.length > 0) {
    const headerLine = `## Most recent session — ${turnRows.length} turn${turnRows.length === 1 ? '' : 's'} (${latestSessionId.slice(0, 8)})`;
    sectionLines.push(headerLine, '');
    used += headerLine.length + 2;

    // Reverse so turns read chronologically (oldest first within section).
    const chronological = [...turnRows].reverse();
    const turnLines: string[] = [];
    let turnsKept = 0;
    // Walk reverse-chronologically (newest first) when budget-cutting, so
    // we keep the freshest turns when budget is tight.
    for (const t of turnRows) {
      const line = formatTurnLine(t);
      const cost = line.length + 2;
      if (used + cost > charBudget) break;
      turnLines.push(line);
      used += cost;
      turnsKept += 1;
    }
    if (turnsKept > 0) {
      // Re-render in chronological order from the original list (oldest →
      // newest), keeping only the turnsKept most recent.
      const kept = chronological.slice(-turnsKept);
      for (const t of kept) sectionLines.push(formatTurnLine(t));
      includedSessionIds.add(latestSessionId);
      if (turnsKept < turnRows.length) {
        const dropped = turnRows.length - turnsKept;
        sectionLines.push('', `[${dropped} earlier turn${dropped === 1 ? '' : 's'} truncated to fit token budget]`);
      }
    } else {
      // Couldn't fit a single turn; remove the section header we added.
      sectionLines.splice(-2, 2);
      used -= headerLine.length + 2;
    }
  }

  const header = '# Spine — recent context';
  const context =
    sectionLines.length === 0
      ? `${header}\n\n(no recent sessions yet — capture some turns and try again)`
      : `${header}\n\n${sectionLines.join('\n').trim()}`;

  return withCors(
    NextResponse.json({
      context,
      sessions_recalled: includedSessionIds.size,
      digests_count: digestRows.length,
      turns_count: turnRows.length,
      latest_session_id: latestSessionId,
    })
  );
}
