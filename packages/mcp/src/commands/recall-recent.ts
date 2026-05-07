/**
 * Claude Code SessionStart hook — recent-session context injection.
 *
 * Claude Code invokes this as:
 *   npx spine-mcp recall-recent
 * with a JSON blob on stdin (or no stdin):
 *   { session_id?, max_tokens? }
 *
 * Pulls the last 1-3 session digests + the most recent session's last 50
 * turns, formats under a token budget (default 2000), and prints to stdout.
 * Claude Code captures stdout and prepends it to the new session's context.
 *
 * Never blocks the session — any failure is silent.
 */

import { DEFAULT_API_BASE, readConfig, DB_PATH } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';

interface HookInput {
  session_id?: string;
  max_tokens?: number;
}

async function readStdin(): Promise<string> {
  let raw = '';
  if (process.stdin.isTTY) return raw;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk as string;
  return raw;
}

export async function recallRecentCommand(): Promise<void> {
  const raw = await readStdin();
  let input: HookInput = {};
  try {
    input = JSON.parse(raw || '{}') as HookInput;
  } catch {
    /* proceed with defaults */
  }
  const maxTokens =
    typeof input.max_tokens === 'number' && Number.isFinite(input.max_tokens)
      ? Math.floor(input.max_tokens)
      : 2000;

  const config = await readConfig();
  try {
    if (config.mode === 'cloud' && config.apiKey) {
      const store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      const result = await store.recallRecent(maxTokens);
      if (result.context.trim()) process.stdout.write(result.context + '\n');
      return;
    }
    const store = new LocalStore(DB_PATH);
    try {
      const result = await store.recallRecent(maxTokens);
      if (result.context.trim()) process.stdout.write(result.context + '\n');
    } finally {
      store.close();
    }
  } catch {
    // Never block the session start. Silent failure leaves the SessionStart
    // hook output empty, which Claude Code treats as "no extra context".
  }
}
