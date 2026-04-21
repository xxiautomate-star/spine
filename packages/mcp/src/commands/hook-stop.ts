/**
 * Claude Code Stop hook — auto-ingests a session summary when Claude stops.
 *
 * Claude Code invokes this as:
 *   npx @spine/mcp hook-stop
 * with a JSON blob on stdin:
 *   { session_id, stop_hook_active, transcript_path }
 *
 * It reads the last few turns from the transcript, builds a terse summary,
 * and fires a spine_capture into the configured store (local or cloud).
 *
 * Nothing is written if:
 *  - stop_hook_active is true (we are inside a hook — avoid recursion)
 *  - transcript_path is missing or unreadable
 *  - the last turns are empty / tool-only
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { loadProjectConfig, applyConfigToCapture } from '../project-config.js';

const SPINE_DB_PATH = join(homedir(), '.spine', 'memories.db');
const MAX_TASK_CHARS = 400;
const MAX_OUTCOME_CHARS = 600;

// ── Types ─────────────────────────────────────────────────────────────────────

interface HookInput {
  session_id?: string;
  stop_hook_active?: boolean;
  transcript_path?: string;
}

type ContentBlock = { type: string; text?: string };

interface Turn {
  type?: string;
  role?: 'user' | 'assistant';
  message?: {
    role?: string;
    content?: string | ContentBlock[];
  };
  // flat form (some versions of CC emit this)
  content?: string | ContentBlock[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    .filter(Boolean) as Turn[];
}

function extractText(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!.trim())
    .join('\n')
    .trim();
}

function getTurnRole(t: Turn): 'user' | 'assistant' | null {
  const r = t.role ?? t.message?.role ?? t.type;
  if (r === 'user' || r === 'human') return 'user';
  if (r === 'assistant') return 'assistant';
  return null;
}

function getTurnContent(t: Turn): string {
  return extractText(t.content ?? t.message?.content);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function hookStopCommand(): Promise<void> {
  const raw = await readStdin();

  let hookInput: HookInput = {};
  try {
    hookInput = JSON.parse(raw || '{}') as HookInput;
  } catch {
    /* proceed with empty */
  }

  // Guard against recursion — Claude Code sets this when re-entering
  if (hookInput.stop_hook_active) return;

  const transcriptPath = hookInput.transcript_path;
  if (!transcriptPath) return;

  const turns = await parseTranscript(transcriptPath);
  if (turns.length === 0) return;

  // Walk backwards: find last user turn and last assistant turn
  let lastUserText = '';
  let lastAssistantText = '';
  for (let i = turns.length - 1; i >= 0; i--) {
    const role = getTurnRole(turns[i]);
    const text = getTurnContent(turns[i]);
    if (!text) continue;
    if (role === 'user' && !lastUserText) lastUserText = text;
    if (role === 'assistant' && !lastAssistantText) lastAssistantText = text;
    if (lastUserText && lastAssistantText) break;
  }

  if (!lastUserText && !lastAssistantText) return;

  const task = lastUserText.slice(0, MAX_TASK_CHARS);
  const outcome = lastAssistantText.slice(0, MAX_OUTCOME_CHARS);
  const sessionId = hookInput.session_id?.slice(0, 8) ?? 'unknown';

  const lines: string[] = [`[session:${sessionId}]`];
  if (task) lines.push(`Task: ${task}`);
  if (outcome) lines.push(`Outcome: ${outcome}`);
  const content = lines.join('\n');

  const [spineConfig, projectConfig] = await Promise.all([
    readConfig(),
    loadProjectConfig(),
  ]);

  const { tags, skip } = applyConfigToCapture(content, projectConfig, ['auto', 'session-end']);

  if (skip) return; // below min length — don't capture

  try {
    if (spineConfig.mode === 'cloud' && spineConfig.apiKey) {
      const store = new CloudStore(spineConfig.apiBase ?? DEFAULT_API_BASE, spineConfig.apiKey);
      await store.capture({
        content,
        source: 'claude-code',
        type: 'context',
        tags,
      });
    } else {
      const store = new LocalStore(SPINE_DB_PATH);
      await store.capture({
        content,
        source: 'claude-code',
        type: 'context',
        tags,
      });
      store.close();
    }
  } catch {
    // Fire-and-forget — never block the session
  }
}
