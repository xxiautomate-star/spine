// Session memory: per-conversation query/answer history stored in
// spine_session_history. Enables follow-up questions ("what about the auth
// flow instead?") without re-explaining the codebase each turn.
//
// A session is identified by a UUID generated at conversation start. Each turn
// stores the query, Spine's answer, and which memory IDs contributed context.
// The last HISTORY_WINDOW turns are injected as context on each new query.
//
// Sessions auto-expire after 7 days (enforced by DB trigger in migration 009).

import { randomUUID } from 'node:crypto';
import { getSupabase } from './supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

const HISTORY_WINDOW = 10;    // turns to include in context
const MAX_ANSWER_STORED = 2000; // truncate stored answers to keep the table lean
const MAX_QUERY_STORED  = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionTurn = {
  id: string;
  sessionId: string;
  turnIndex: number;
  query: string;
  answer: string;
  contextMemoryIds: string[];
  createdAt: string;
};

export type SessionContext = {
  sessionId: string;
  history: SessionTurn[];
  contextBlock: string; // formatted string ready to prepend to next query
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new session. Returns the session UUID to pass through the
 * conversation lifecycle.
 *
 * In MCP usage: call at the start of each Claude Code session (hook-stop
 * has the session_id, which can double as the Spine session ID).
 */
export function startSession(): string {
  return randomUUID();
}

/**
 * Persist a completed query/answer turn to session history.
 *
 * @param sessionId       UUID from startSession()
 * @param userId          Spine user ID
 * @param query           What the user asked
 * @param answer          What Spine answered (cross-repo synthesis, recall result, etc.)
 * @param contextMemoryIds IDs of the memory chunks that contributed to this answer
 */
export async function addTurn(
  sessionId: string,
  userId: string,
  query: string,
  answer: string,
  contextMemoryIds: string[] = []
): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;

  // Get current turn count for this session
  const { count } = await sb
    .from('spine_session_history')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('user_id', userId);

  const turnIndex = count ?? 0;

  const { data, error } = await sb
    .from('spine_session_history')
    .insert({
      session_id: sessionId,
      user_id: userId,
      turn_index: turnIndex,
      query: truncate(query, MAX_QUERY_STORED),
      answer: truncate(answer, MAX_ANSWER_STORED),
      context_memory_ids: contextMemoryIds,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) return null;
  return data.id as string;
}

/**
 * Retrieve recent history for a session and build a formatted context block
 * ready to prepend to the next query.
 *
 * @param sessionId  UUID from startSession()
 * @param userId     Spine user ID
 * @param limit      Max turns to load (default: HISTORY_WINDOW)
 */
export async function getSessionContext(
  sessionId: string,
  userId: string,
  limit = HISTORY_WINDOW
): Promise<SessionContext> {
  const sb = getSupabase();
  const empty: SessionContext = {
    sessionId,
    history: [],
    contextBlock: '',
  };

  if (!sb) return empty;

  const { data, error } = await sb
    .from('spine_session_history')
    .select('id, session_id, turn_index, query, answer, context_memory_ids, created_at')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('turn_index', { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) return empty;

  const turns: SessionTurn[] = (data as Array<{
    id: string;
    session_id: string;
    turn_index: number;
    query: string;
    answer: string;
    context_memory_ids: string[] | null;
    created_at: string;
  }>)
    .reverse() // chronological order
    .map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      turnIndex: r.turn_index,
      query: r.query,
      answer: r.answer,
      contextMemoryIds: r.context_memory_ids ?? [],
      createdAt: r.created_at,
    }));

  const contextBlock = buildContextBlock(turns);
  return { sessionId, history: turns, contextBlock };
}

/**
 * Format session history as a context block to inject before the next query.
 *
 * Structure:
 *   <spine_session>
 *   [Turn 1] User: ...  Spine: ...
 *   [Turn 2] ...
 *   </spine_session>
 */
function buildContextBlock(turns: SessionTurn[]): string {
  if (turns.length === 0) return '';

  const lines = ['<spine_session>', `${turns.length} prior turn(s) in this session:`, ''];

  for (const turn of turns) {
    const q = turn.query.length > 200 ? turn.query.slice(0, 200) + '…' : turn.query;
    // Show a condensed version of the answer to not overwhelm context
    const a = turn.answer.length > 400 ? turn.answer.slice(0, 400) + '…' : turn.answer;
    lines.push(`[Turn ${turn.turnIndex + 1}]`);
    lines.push(`Q: ${q}`);
    lines.push(`A: ${a}`);
    if (turn.contextMemoryIds.length > 0) {
      lines.push(`Context from: ${turn.contextMemoryIds.length} memories`);
    }
    lines.push('');
  }

  lines.push('</spine_session>');
  return lines.join('\n');
}

/**
 * Delete all turns for a session (user-initiated reset).
 */
export async function clearSession(sessionId: string, userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb
    .from('spine_session_history')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId);
}

/**
 * List active sessions for a user (sessions with activity in last 7 days).
 */
export async function listActiveSessions(
  userId: string
): Promise<Array<{ sessionId: string; turnCount: number; lastActivity: string }>> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data } = await sb
    .from('spine_session_history')
    .select('session_id, created_at')
    .eq('user_id', userId)
    .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200);

  if (!data) return [];

  const bySession = new Map<string, { count: number; last: string }>();
  for (const row of data) {
    const sid = row.session_id as string;
    const existing = bySession.get(sid);
    if (!existing || row.created_at > existing.last) {
      bySession.set(sid, {
        count: (existing?.count ?? 0) + 1,
        last: row.created_at as string,
      });
    } else {
      existing.count++;
    }
  }

  return [...bySession.entries()].map(([sessionId, { count, last }]) => ({
    sessionId,
    turnCount: count,
    lastActivity: last,
  }));
}

/**
 * Augment a query with session history context.
 *
 * Use this to transform a bare follow-up question into a self-contained query
 * that doesn't require the caller to re-explain state. Returns the original
 * query if no history exists.
 */
export async function augmentQueryWithHistory(
  sessionId: string,
  userId: string,
  query: string
): Promise<string> {
  const ctx = await getSessionContext(sessionId, userId, 5); // last 5 turns only
  if (!ctx.contextBlock) return query;
  return `${ctx.contextBlock}\n\nCurrent question: ${query}`;
}
