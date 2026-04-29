/**
 * Claude Code Stop / SessionEnd hook — write the structured digest.
 *
 * Claude Code invokes this as:
 *   npx @spine/mcp session-digest
 * with a JSON blob on stdin (Stop hook protocol):
 *   { session_id, transcript_path, stop_hook_active }
 *
 * Parses the transcript to extract files touched + commits made (best-
 * effort heuristics), then writes one digest row tagged kind=digest.
 * Decisions / state / open_threads / mistakes are left empty by default —
 * Claude can populate them mid-session by calling spine_session_digest as
 * an MCP tool with structured fields, which produces a richer digest.
 *
 * Append-only. Never blocks the session.
 */

import { readFile } from 'node:fs/promises';
import { DEFAULT_API_BASE, readConfig, DB_PATH } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import type { DigestPayload } from '../store/index.js';

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> };

interface Turn {
  type?: string;
  role?: string;
  message?: { role?: string; content?: string | Block[] };
  content?: string | Block[];
}

async function readStdin(): Promise<string> {
  let raw = '';
  if (process.stdin.isTTY) return raw;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk as string;
  return raw;
}

async function parseTranscript(path: string): Promise<Turn[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Turn;
      } catch {
        return null;
      }
    })
    .filter((x): x is Turn => x !== null);
}

function blocks(t: Turn): Block[] {
  const c = t.content ?? t.message?.content;
  if (Array.isArray(c)) return c;
  return [];
}

function extractFilesTouched(turns: Turn[]): string[] {
  const seen = new Set<string>();
  for (const t of turns) {
    for (const b of blocks(t)) {
      if (b.type !== 'tool_use' || !b.input) continue;
      const args = b.input as Record<string, unknown>;
      for (const key of ['file_path', 'path', 'notebook_path']) {
        const v = args[key];
        if (typeof v === 'string' && v.length > 0) seen.add(v);
      }
    }
  }
  return [...seen].slice(0, 50);
}

function extractCommits(turns: Turn[]): string[] {
  const out: string[] = [];
  const re = /git commit -m ['"]([^'"]+)['"]/g;
  for (const t of turns) {
    for (const b of blocks(t)) {
      if (b.type === 'tool_use' && b.name === 'Bash' && b.input) {
        const cmd = (b.input as { command?: string }).command;
        if (typeof cmd === 'string') {
          let m: RegExpExecArray | null;
          while ((m = re.exec(cmd)) !== null) {
            out.push(m[1].split('\n')[0].slice(0, 120));
          }
        }
      }
    }
  }
  return out.slice(0, 20);
}

export async function sessionDigestCommand(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = JSON.parse(raw || '{}') as HookInput;
  } catch {
    return;
  }

  if (input.stop_hook_active) return;
  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  if (!sessionId) return;

  const turns = input.transcript_path ? await parseTranscript(input.transcript_path) : [];
  const filesTouched = extractFilesTouched(turns);
  const commits = extractCommits(turns);

  const payload: DigestPayload = {
    sessionId,
    decisions: [],
    state: turns.length > 0 ? `Session ended with ${turns.length} turns logged.` : '',
    openThreads: [],
    mistakes: [],
    filesTouched,
    commits,
    source: 'claude-code',
  };

  const config = await readConfig();
  try {
    if (config.mode === 'cloud' && config.apiKey) {
      const store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      await store.captureDigest(payload);
      return;
    }
    const store = new LocalStore(DB_PATH);
    try {
      await store.captureDigest(payload);
    } finally {
      store.close();
    }
  } catch {
    // Fire-and-forget; never block session end.
  }
}
