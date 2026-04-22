/**
 * Claude Code UserPromptSubmit hook — proactive memory injection.
 *
 * Claude Code invokes this as:
 *   npx @spine/mcp inject
 * with a JSON blob on stdin:
 *   { session_id, prompt }
 *
 * The hook queries Spine for the top 5 memories most relevant to the
 * user's current prompt and outputs a formatted context block to stdout.
 * Claude Code injects that block before the model sees the user's message.
 *
 * The user never has to call search_memory — context arrives automatically.
 *
 * Exit codes:
 *   0 — ok (with or without memories found)
 *   Any non-zero — Claude Code aborts the prompt (we never do this)
 */

import { DEFAULT_API_BASE, readConfig } from '../config.js';
import { CloudStore } from '../store/cloud.js';
import { LocalStore } from '../store/local.js';
import { DB_PATH } from '../config.js';
import type { Memory } from '../store/index.js';

interface InjectInput {
  session_id?: string;
  prompt?: string;
}

async function readStdin(): Promise<string> {
  let raw = '';
  if (process.stdin.isTTY) return raw;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk as string;
  return raw;
}

function formatMemories(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = [
    '<spine_memory>',
    'Relevant context from your past sessions:',
    '',
  ];

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const date = m.createdAt
      ? new Date(m.createdAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })
      : 'unknown date';
    const source = m.source ? ` · ${m.source}` : '';
    lines.push(`[${i + 1}] ${date}${source}`);
    // Trim content to ~800 chars so injected block doesn't overwhelm context
    const body = m.content.length > 800
      ? m.content.slice(0, 800) + '…'
      : m.content;
    lines.push(body);
    lines.push('');
  }

  lines.push('</spine_memory>');
  return lines.join('\n');
}

export async function injectCommand(): Promise<void> {
  const raw = await readStdin();

  let input: InjectInput = {};
  try {
    input = JSON.parse(raw || '{}') as InjectInput;
  } catch {
    /* proceed without prompt */
  }

  const query = input.prompt?.trim();
  // Skip injection if prompt is too short to be meaningful
  if (!query || query.length < 8) return;

  const config = await readConfig();

  let memories: Memory[] = [];

  try {
    if (config.mode === 'cloud' && config.apiKey) {
      const store = new CloudStore(config.apiBase ?? DEFAULT_API_BASE, config.apiKey);
      memories = await store.recall(query, 5);
    } else {
      const store = new LocalStore(DB_PATH);
      memories = await store.recall(query, 5);
      store.close();
    }
  } catch {
    // Never block the user's prompt on a Spine failure
    return;
  }

  if (memories.length === 0) return;

  const block = formatMemories(memories);
  process.stdout.write(block + '\n');
}
