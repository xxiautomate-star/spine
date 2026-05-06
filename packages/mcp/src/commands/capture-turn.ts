/**
 * Claude Code UserPromptSubmit hook — single-turn capture.
 *
 * Claude Code invokes this as:
 *   npx @spine/mcp capture-turn
 * with a JSON blob on stdin (UserPromptSubmit hook protocol):
 *   { session_id, prompt }
 *
 * Stores the user's prompt as a single turn row tagged with the session id.
 * Append-only. Never blocks the session — failures are silent.
 *
 * The same command can be wired to other Claude Code hooks (PostToolUse,
 * Stop) by setting CAPTURE_TURN_ROLE in the environment. Defaults to
 * 'user' (the UserPromptSubmit case).
 *
 * Cost: turns are stored WITHOUT embeddings by default. Set
 * SPINE_EMBED_TURNS=1 in the hook env to opt in for semantic search across
 * every word — at ~$0.00002/embed, 1000 turns ≈ $0.02.
 */

import { DEFAULT_API_BASE, readConfig, DB_PATH } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import type { TurnInput } from '../store/index.js';

interface HookInput {
  session_id?: string;
  prompt?: string;
  // PostToolUse-shape support
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: { content?: string };
}

async function readStdin(): Promise<string> {
  let raw = '';
  if (process.stdin.isTTY) return raw;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk as string;
  return raw;
}

function inferRole(input: HookInput, env: NodeJS.ProcessEnv): 'user' | 'assistant' | 'tool' {
  const fromEnv = env.CAPTURE_TURN_ROLE;
  if (fromEnv === 'user' || fromEnv === 'assistant' || fromEnv === 'tool') return fromEnv;
  if (input.tool_name) return 'tool';
  if (typeof input.prompt === 'string') return 'user';
  return 'user';
}

function inferContent(input: HookInput, role: 'user' | 'assistant' | 'tool'): string {
  if (role === 'user' && typeof input.prompt === 'string') return input.prompt;
  if (role === 'tool') {
    const toolArgs = JSON.stringify(input.tool_input ?? {}, null, 0);
    const resp = input.tool_response?.content ?? '';
    return `${input.tool_name ?? 'tool'}(${toolArgs.length > 800 ? toolArgs.slice(0, 800) + '…' : toolArgs})${resp ? ' → ' + (resp.length > 800 ? resp.slice(0, 800) + '…' : resp) : ''}`;
  }
  return input.prompt ?? '';
}

function inferFilesTouched(input: HookInput): string[] | undefined {
  const args = input.tool_input;
  if (!args || typeof args !== 'object') return undefined;
  const out: string[] = [];
  const candidates = ['file_path', 'path', 'notebook_path'];
  for (const key of candidates) {
    const v = (args as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

export async function captureTurnCommand(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = JSON.parse(raw || '{}') as HookInput;
  } catch {
    return;
  }

  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  if (!sessionId) return;

  const role = inferRole(input, process.env);
  const content = inferContent(input, role);
  if (!content || content.trim().length < 2) return;

  const turnInput: TurnInput = {
    sessionId,
    role,
    content,
    toolName: typeof input.tool_name === 'string' ? input.tool_name : undefined,
    filesTouched: inferFilesTouched(input),
    ts: new Date().toISOString(),
    embedTurns: process.env.SPINE_EMBED_TURNS === '1',
  };

  const config = await readConfig();
  try {
    if (config.mode === 'cloud' && config.apiKey) {
      const store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      await store.captureTurn(turnInput);
      return;
    }
    // Local mode = user's own machine. Plan cap is for cloud billing only.
    const store = new LocalStore(DB_PATH, { enforceCap: false });
    try {
      await store.captureTurn(turnInput);
    } finally {
      store.close();
    }
  } catch (err) {
    // Fire-and-forget; never block the prompt. But log so future silent
    // failures are debuggable.
    try {
      const { appendFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const logPath = join(homedir(), '.spine', 'error.log');
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await appendFile(logPath, `[${new Date().toISOString()}] capture-turn: ${msg}\n`);
    } catch {
      /* swallow */
    }
  }
}
