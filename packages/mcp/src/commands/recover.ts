/**
 * Crash-recovery for orphaned session buffers.
 *
 * Wired to the SessionStart hook (Claude Code) — runs once at the very
 * beginning of a fresh session. Walks ~/.spine/session_buffer.db for
 * sessions that still have unflushed turns and:
 *
 *   1. Excludes the *current* session id (this is a fresh session — its
 *      buffer entries are legitimate, not orphans).
 *   2. For each remaining session, fires a `phase:recovered` digest to
 *      cloud (or local store) summarising what was captured.
 *   3. Marks those rows flushed so the next session start doesn't
 *      re-emit duplicates.
 *
 * The digest is deliberately minimal — we don't have decisions / state /
 * mistakes since the user never made it to the structured Stop hook.
 * Instead we surface the count of turns + the time window + the inferred
 * files-touched. That's enough for /api/recall/recent to show "previous
 * session crashed; ${n} turns recovered between ${t1} and ${t2}".
 *
 * Failures are silent — we never block session start. Worst case is
 * rerunning recover on the next session start, which is idempotent
 * (turns stay marked unflushed if the digest write failed).
 */

import { DEFAULT_API_BASE, readConfig, DB_PATH } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { SessionBuffer, type BufferedTurn } from '../store/session-buffer.js';
import type { DigestPayload, Store } from '../store/index.js';

interface HookInput {
  session_id?: string;
}

async function readStdin(): Promise<string> {
  let raw = '';
  if (process.stdin.isTTY) return raw;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk as string;
  return raw;
}

function summariseTurns(turns: BufferedTurn[]): {
  state: string;
  filesTouched: string[];
} {
  const userTurns = turns.filter((t) => t.role === 'user').length;
  const toolTurns = turns.filter((t) => t.role === 'tool').length;
  const first = turns[0]?.ts;
  const last = turns[turns.length - 1]?.ts;
  const window = first && last ? `${first} → ${last}` : 'unknown window';
  const state =
    `Recovered from a session that ended without a Stop-hook digest. ` +
    `${turns.length} turns logged between ${window} ` +
    `(${userTurns} user, ${toolTurns} tool). ` +
    `Structured fields (decisions / open threads / mistakes) were never ` +
    `populated — refer to the per-turn buffer for raw content.`;

  const fileSet = new Set<string>();
  for (const t of turns) {
    if (!t.filesTouched) continue;
    for (const f of t.filesTouched) fileSet.add(f);
  }
  return { state, filesTouched: [...fileSet].slice(0, 50) };
}

async function fireRecoveredDigest(
  store: Store,
  sessionId: string,
  turns: BufferedTurn[],
): Promise<boolean> {
  const { state, filesTouched } = summariseTurns(turns);
  const payload: DigestPayload = {
    sessionId,
    decisions: [],
    state,
    openThreads: [],
    mistakes: [],
    filesTouched,
    commits: [],
    source: 'claude-code',
    phase: 'recovered',
  };
  try {
    await store.captureDigest(payload);
    return true;
  } catch {
    return false;
  }
}

export async function recoverCommand(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = JSON.parse(raw || '{}') as HookInput;
  } catch {
    /* hook payload missing — proceed with empty current-session id */
  }
  const currentSessionId = typeof input.session_id === 'string' ? input.session_id : '';

  let buffer: SessionBuffer | null = null;
  let store: Store | null = null;
  try {
    buffer = new SessionBuffer();
    const orphans = buffer
      .unflushedSessions()
      .filter((s) => s.sessionId !== currentSessionId)
      // 2 turns is the floor; below that the digest carries no signal.
      .filter((s) => s.turnCount >= 2);
    if (orphans.length === 0) return;

    const config = await readConfig();
    if (config.mode === 'cloud' && config.apiKey) {
      store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
    } else {
      store = new LocalStore(DB_PATH);
    }

    let recovered = 0;
    for (const orphan of orphans) {
      const turns = buffer.turnsForSession(orphan.sessionId);
      if (turns.length < 2) continue;
      const ok = await fireRecoveredDigest(store, orphan.sessionId, turns);
      if (ok) {
        buffer.markFlushed(orphan.sessionId);
        recovered += 1;
      }
    }
    if (recovered > 0) {
      console.error(
        `[spine] recovered ${recovered} orphaned session${recovered === 1 ? '' : 's'} from buffer`,
      );
    }
    buffer.pruneOlderThan(14);
  } catch {
    /* SessionStart must never block — swallow */
  } finally {
    buffer?.close();
    store?.close();
  }
}
