// Trace reasoner: accepts a raw stack trace (Node/Python/Browser formats),
// parses it into frames, retrieves surrounding code context for each non-library
// frame, builds a call graph, and asks Haiku to identify the ROOT CAUSE frame —
// not just where it threw, but why.
//
// File reading strategy (in priority order):
//   1. Read the actual file from disk if the path resolves locally
//   2. Fall back to Spine's indexed memories for the file path
//   3. Skip frames with no retrievable context

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankMemories } from './retrieval';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const CONTEXT_LINES = 40;    // lines of source to pull around the error line
const MAX_FRAMES = 8;        // cap before synthesis — deeper frames rarely matter

// ── Root cause prompt ─────────────────────────────────────────────────────────

const ROOT_CAUSE_SYSTEM = `You are Spine's debugging engine, specialising in root cause analysis.

You receive a stack trace and retrieved source code context for each frame. Your job is to:

1. Identify the ROOT CAUSE frame — the frame where the bug was INTRODUCED, not where it threw.
   (e.g. if frame 3 calls .map() on undefined, the root cause is likely where undefined was passed in frame 4-7)

2. Explain WHY it threw, quoting the actual retrieved code.

3. Trace the data flow: which variable was undefined/null/wrong-type, where it was set, where the invariant broke.

4. Distinguish between: the ERROR SITE (where the exception was raised), the ORIGIN SITE (where the bad value was produced), and the CONTRACT VIOLATION (where the calling code assumed something that wasn't guaranteed).

Output strict JSON:
{
  "error_summary": "<one sentence — what went wrong>",
  "error_site": {
    "frame_index": 0,
    "file": "<path>",
    "line": 0,
    "function": "<name>",
    "explanation": "<what the code was trying to do when it threw>"
  },
  "root_cause_frame": {
    "frame_index": 0,
    "file": "<path>",
    "line": 0,
    "function": "<name>",
    "explanation": "<why this is the root cause, with code quote>"
  },
  "bad_value": {
    "variable": "<name>",
    "expected_type": "<what it should be>",
    "actual_type": "<what it was>",
    "origin": "<where this value came from>"
  },
  "data_flow": ["<step 1>", "<step 2>", "<step 3>"],
  "fix_hint": "<one-sentence fix direction>"
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type StackFrame = {
  index: number;
  raw: string;
  file: string | null;
  line: number | null;
  col: number | null;
  functionName: string | null;
  isNodeModule: boolean;
  isBuiltin: boolean;
  sourceContext: string | null;   // retrieved source lines
  memoryContext: string | null;   // fallback: relevant Spine memories
};

export type BadValue = {
  variable: string;
  expected_type: string;
  actual_type: string;
  origin: string;
};

export type TraceResult = {
  errorMessage: string;
  errorType: string;
  frames: StackFrame[];
  errorSite: StackFrame | null;
  rootCauseFrame: StackFrame | null;
  badValue: BadValue | null;
  dataFlow: string[];
  fixHint: string;
  rawSynthesis: string;
  latencyMs: number;
};

// ── Stack trace parsers ───────────────────────────────────────────────────────

// Node.js / V8:  "    at FunctionName (path/to/file.ts:84:23)"
//                "    at path/to/file.ts:84:23"
const NODE_FRAME = /^\s+at\s+(?:(.+?)\s+)?\(?([^()]+?):(\d+):(\d+)\)?$/;

// Python:        "  File 'path/to/file.py', line 84, in function_name"
const PYTHON_FRAME = /^\s+File ['"](.+?)['"],\s+line (\d+),\s+in (.+)$/;

// Browser (Firefox/Safari): "functionName@http://host/path:84:23"
const FIREFOX_FRAME = /^(.+?)@(.+?):(\d+):(\d+)$/;

// Error message header: "TypeError: Cannot read properties of undefined"
const ERROR_HEADER = /^([\w.]+(?:Error|Exception)?)[:\s]+(.+)$/;

function parseFrame(raw: string, index: number): StackFrame | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('(') && trimmed.endsWith(')')) return null;

  let file: string | null = null;
  let line: number | null = null;
  let col: number | null = null;
  let functionName: string | null = null;

  // Node/V8
  const nodeMatch = NODE_FRAME.exec(trimmed);
  if (nodeMatch) {
    functionName = nodeMatch[1]?.trim() ?? null;
    file = nodeMatch[2]?.trim() ?? null;
    line = nodeMatch[3] ? parseInt(nodeMatch[3], 10) : null;
    col = nodeMatch[4] ? parseInt(nodeMatch[4], 10) : null;
  }

  // Python
  if (!file) {
    const pyMatch = PYTHON_FRAME.exec(trimmed);
    if (pyMatch) {
      file = pyMatch[1];
      line = pyMatch[2] ? parseInt(pyMatch[2], 10) : null;
      functionName = pyMatch[3];
    }
  }

  // Firefox
  if (!file) {
    const ffMatch = FIREFOX_FRAME.exec(trimmed);
    if (ffMatch) {
      functionName = ffMatch[1] || null;
      file = ffMatch[2];
      line = ffMatch[3] ? parseInt(ffMatch[3], 10) : null;
      col = ffMatch[4] ? parseInt(ffMatch[4], 10) : null;
    }
  }

  if (!file) return null;

  const isNodeModule = file.includes('node_modules') || file.startsWith('internal/') || file.startsWith('node:');
  const isBuiltin = file.startsWith('node:') || /^(fs|path|http|https|events|stream|buffer|crypto)$/.test(file);

  return {
    index,
    raw: trimmed,
    file,
    line,
    col,
    functionName,
    isNodeModule,
    isBuiltin,
    sourceContext: null,
    memoryContext: null,
  };
}

export function parseStackTrace(raw: string): { errorType: string; errorMessage: string; frames: StackFrame[] } {
  const lines = raw.split('\n');
  let errorType = 'Error';
  let errorMessage = 'Unknown error';
  const frames: StackFrame[] = [];
  let frameIndex = 0;

  for (const line of lines) {
    const headerMatch = ERROR_HEADER.exec(line.trim());
    if (headerMatch && frames.length === 0) {
      errorType = headerMatch[1];
      errorMessage = headerMatch[2];
      continue;
    }
    const frame = parseFrame(line, frameIndex);
    if (frame) {
      frames.push(frame);
      frameIndex++;
    }
  }

  return { errorType, errorMessage, frames };
}

// ── Source context retrieval ───────────────────────────────────────────────────

async function readSourceContext(
  file: string,
  errorLine: number | null,
  repoRoot: string
): Promise<string | null> {
  if (!errorLine) return null;

  // Try several path resolutions
  const candidates = [
    resolve(repoRoot, file),
    resolve(process.cwd(), file),
    resolve(file),
  ];

  for (const fullPath of candidates) {
    try {
      const content = await readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      const start = Math.max(0, errorLine - Math.floor(CONTEXT_LINES / 2));
      const end = Math.min(lines.length, errorLine + Math.ceil(CONTEXT_LINES / 2));
      const contextLines = lines.slice(start, end);
      return contextLines
        .map((l, i) => {
          const lineNum = start + i + 1;
          const marker = lineNum === errorLine ? '→ ' : '  ';
          return `${marker}${String(lineNum).padStart(4)} | ${l}`;
        })
        .join('\n');
    } catch {
      continue;
    }
  }
  return null;
}

async function retrieveMemoryContext(
  userId: string,
  frame: StackFrame
): Promise<string | null> {
  if (!frame.file) return null;
  const query = [
    frame.functionName ?? '',
    frame.file.split('/').pop() ?? '',
    frame.line ? `line ${frame.line}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const candidates = await rankMemories(userId, query, { poolLimit: 8, limit: 3 }).catch(() => []);
  if (candidates.length === 0) return null;

  return candidates
    .map((c) => {
      const src = c.source ? `[${c.source}]` : '';
      return `${src}\n${c.content.slice(0, 400)}`;
    })
    .join('\n\n---\n\n');
}

// ── Call graph builder ────────────────────────────────────────────────────────

function buildCallGraph(frames: StackFrame[]): string {
  return frames
    .filter((f) => !f.isBuiltin)
    .slice(0, MAX_FRAMES)
    .map((f, i) => {
      const loc = f.file ? `${f.file}:${f.line ?? '?'}` : 'unknown';
      const fn = f.functionName ?? '<anonymous>';
      const source = f.isNodeModule ? '(library)' : '(app)';
      return `${i === 0 ? '✗ THREW' : `  called by`} ${fn} @ ${loc} ${source}`;
    })
    .join('\n');
}

// ── Synthesis call ────────────────────────────────────────────────────────────

async function callSynthesis(
  errorType: string,
  errorMessage: string,
  frames: StackFrame[],
  callGraph: string
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const frameBlocks = frames
    .filter((f) => !f.isBuiltin)
    .slice(0, MAX_FRAMES)
    .map((f) => {
      const loc = `${f.file ?? 'unknown'}:${f.line ?? '?'}`;
      const ctx = f.sourceContext ?? f.memoryContext ?? '(no context available)';
      return `=== Frame ${f.index}: ${f.functionName ?? '<anon>'} @ ${loc} ===\n${ctx}`;
    })
    .join('\n\n');

  const userMsg = `Error: ${errorType}: ${errorMessage}

Call graph (top = where it threw, bottom = deepest caller):
${callGraph}

Retrieved source context per frame:
${frameBlocks}

Identify the root cause.`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: ROOT_CAUSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku trace ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a raw stack trace and identify the root cause frame with code context.
 *
 * @param userId    Spine user ID (for memory fallback)
 * @param rawTrace  Raw stack trace string
 * @param repoRoot  Local path to the repo root (for direct file reads)
 */
export async function reasonTrace(
  userId: string,
  rawTrace: string,
  repoRoot = process.cwd()
): Promise<TraceResult> {
  const started = Date.now();
  const { errorType, errorMessage, frames } = parseStackTrace(rawTrace);

  // Enrich non-library frames with source context in parallel
  const appFrames = frames.filter((f) => !f.isBuiltin).slice(0, MAX_FRAMES);

  await Promise.all(
    appFrames.map(async (frame) => {
      if (!frame.isNodeModule) {
        frame.sourceContext = await readSourceContext(frame.file ?? '', frame.line, repoRoot);
      }
      if (!frame.sourceContext) {
        frame.memoryContext = await retrieveMemoryContext(userId, frame);
      }
    })
  );

  const callGraph = buildCallGraph(frames);
  const rawSynthesis = await callSynthesis(errorType, errorMessage, frames, callGraph);

  type Parsed = {
    error_summary?: string;
    error_site?: { frame_index?: number; file?: string; line?: number; function?: string; explanation?: string };
    root_cause_frame?: { frame_index?: number; file?: string; line?: number; function?: string; explanation?: string };
    bad_value?: BadValue;
    data_flow?: string[];
    fix_hint?: string;
  };

  let parsed: Parsed = {};
  try { parsed = JSON.parse(stripFences(rawSynthesis)) as Parsed; } catch { /* raw fallback */ }

  const lookupFrame = (idx: number | undefined) =>
    frames.find((f) => f.index === (idx ?? 0)) ?? frames[0] ?? null;

  return {
    errorMessage,
    errorType,
    frames,
    errorSite: lookupFrame(parsed.error_site?.frame_index),
    rootCauseFrame: lookupFrame(parsed.root_cause_frame?.frame_index),
    badValue: parsed.bad_value ?? null,
    dataFlow: parsed.data_flow ?? [],
    fixHint: parsed.fix_hint ?? '',
    rawSynthesis,
    latencyMs: Date.now() - started,
  };
}
