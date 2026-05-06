/**
 * Claude Code Stop hook — full transcript capture.
 *
 * Claude Code invokes this as:
 *   npx @spine/mcp hook-stop
 * with a JSON blob on stdin:
 *   { session_id, stop_hook_active, transcript_path }
 *
 * Every turn in the transcript is extracted, assembled into a full conversation
 * text, and chunked into 2000-token segments (~7500 chars). Each chunk is
 * stored as a separate memory via captureBulk. This makes every word of every
 * session semantically searchable — not just a 400+600 char summary.
 *
 * Nothing is written if:
 *  - stop_hook_active is true (avoid recursion)
 *  - transcript_path is missing or unreadable
 *  - the transcript is empty or tool-only
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { loadProjectConfig, applyConfigToCapture } from '../project-config.js';
import type { CaptureInput } from '../store/index.js';

const SPINE_DB_PATH = join(homedir(), '.spine', 'memories.db');

// ~2000 tokens per chunk (1 token ≈ 4 chars)
const CHUNK_SIZE = 7500;
// Overlap between chunks to preserve context at boundaries
const CHUNK_OVERLAP = 300;

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

/**
 * Build a chronological transcript string from all turns with text content.
 * Tool-only turns (no text) are skipped.
 */
function buildTranscript(turns: Turn[], sessionId: string): string {
  const lines: string[] = [`[session:${sessionId}]`];
  for (const turn of turns) {
    const role = getTurnRole(turn);
    const text = getTurnContent(turn);
    if (!text || !role) continue;
    lines.push(`[${role}] ${text}`);
  }
  return lines.join('\n\n');
}

/**
 * Chunk a long text into CHUNK_SIZE segments with CHUNK_OVERLAP overlap.
 * Prefers breaking at paragraph boundaries to avoid mid-sentence splits.
 */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);

    // Try to break at a double-newline (paragraph boundary)
    let breakAt = end;
    if (end < text.length) {
      const paraBreak = text.lastIndexOf('\n\n', end);
      if (paraBreak > start + CHUNK_SIZE * 0.4) {
        breakAt = paraBreak + 2;
      } else {
        // Fall back to any newline
        const lineBreak = text.lastIndexOf('\n', end);
        if (lineBreak > start + CHUNK_SIZE * 0.4) {
          breakAt = lineBreak + 1;
        }
      }
    }

    chunks.push(text.slice(start, breakAt).trim());
    // Overlap: back up by CHUNK_OVERLAP so context is preserved across boundaries
    start = Math.max(start + 1, breakAt - CHUNK_OVERLAP);
  }

  return chunks.filter((c) => c.length > 0);
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

  if (hookInput.stop_hook_active) return;

  const transcriptPath = hookInput.transcript_path;
  if (!transcriptPath) return;

  const turns = await parseTranscript(transcriptPath);
  if (turns.length === 0) return;

  const sessionId = hookInput.session_id?.slice(0, 8) ?? 'unknown';

  // Build the full transcript text from all turns
  const fullTranscript = buildTranscript(turns, sessionId);
  if (fullTranscript.trim().length < 50) return;

  const [spineConfig, projectConfig] = await Promise.all([
    readConfig(),
    loadProjectConfig(),
  ]);

  // Apply project config to determine tags and min-length check
  const { tags: baseTags, skip } = applyConfigToCapture(
    fullTranscript,
    projectConfig,
    ['session-end']
  );
  if (skip) return;

  // Chunk the full transcript
  const chunks = chunkText(fullTranscript);
  const total = chunks.length;

  // Build capture inputs — one per chunk
  const inputs: CaptureInput[] = chunks.map((chunk, i) => ({
    content: total > 1 ? `[chunk:${i + 1}/${total}]\n${chunk}` : chunk,
    source: 'claude-code',
    type: 'context',
    tags: [...baseTags, 'session-chunk', `session:${sessionId}`],
  }));

  try {
    if (spineConfig.mode === 'cloud' && spineConfig.apiKey) {
      const store = new CloudStore(spineConfig.apiBase ?? DEFAULT_API_BASE, spineConfig.apiKey);
      await store.captureBulk(inputs);
    } else {
      // Local mode = the user's own machine. The plan cap (free=100) is a
      // SaaS billing concept — it should NEVER apply to local SQLite, otherwise
      // every Stop hook silently throws PlanLimitError once the local DB
      // crosses 100 rows. enforceCap:false here is the fix.
      const store = new LocalStore(SPINE_DB_PATH, { enforceCap: false });
      try {
        await store.captureBulk(inputs);
      } finally {
        store.close();
      }
    }
  } catch (err) {
    // Fire-and-forget — never block the session — but DO leave a breadcrumb so
    // future silent failures are debuggable. Append to ~/.spine/error.log.
    try {
      const { appendFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { homedir } = await import('node:os');
      const logPath = join(homedir(), '.spine', 'error.log');
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await appendFile(logPath, `[${new Date().toISOString()}] hook-stop: ${msg}\n`);
    } catch {
      /* really nothing we can do */
    }
  }
}
