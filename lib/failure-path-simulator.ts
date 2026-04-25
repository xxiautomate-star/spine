// Failure path simulator: given a natural language bug report, identifies the
// component, traces its data dependencies, enumerates failure modes in the
// logic tree, and ranks them by likelihood. Returns top 3 candidates with
// file:line pointers — so the next step (fix-candidate-generator) knows exactly
// where to look.

import { rankMemories } from './retrieval';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const FAILURE_MODE_SYSTEM = `You are Spine's failure path analyser.

Given a bug report and the source code of the suspect component, you must:

1. Identify the component's data dependencies:
   - Props (with types — what's optional vs required?)
   - React hooks: useState initial values, useEffect dependencies, useContext
   - External data: API calls, Supabase queries, route params
   - Parent-supplied callbacks and their signatures

2. For each dependency, enumerate every failure mode — every path where the value could be wrong, missing, stale, or in an unexpected state.

3. Rank each failure mode by likelihood given the reported symptom. Use these signals:
   - "doesn't work on mobile" → viewport, pointer events, touch, CSS media queries
   - "undefined error" → missing null guard, optional prop used as required
   - "blank/empty" → async data not yet loaded, empty array, wrong key
   - "wrong data" → stale state, incorrect dependency array, race condition
   - "works sometimes" → race condition, async, event timing

Output strict JSON:
{
  "component_name": "<name>",
  "file_path": "<path>",
  "dependencies": {
    "props": ["<prop: type (optional/required)>"],
    "hooks": ["<useState('initialValue')>", "<useEffect([dep1, dep2])>"],
    "external": ["<fetch('/api/x')>", "<supabase.from('y').select()>"]
  },
  "failure_modes": [
    {
      "rank": 1,
      "hypothesis": "<what we think is wrong>",
      "file": "<path>",
      "line": <number or null>,
      "likelihood": "high | medium | low",
      "evidence": "<quote from the code that supports this hypothesis>",
      "symptom_match": "<why this explains the reported symptom>"
    }
  ]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FailureMode = {
  rank: number;
  hypothesis: string;
  file: string;
  line: number | null;
  likelihood: 'high' | 'medium' | 'low';
  evidence: string;
  symptom_match: string;
};

export type DataDependencies = {
  props: string[];
  hooks: string[];
  external: string[];
};

export type FailurePathResult = {
  componentName: string;
  filePath: string;
  bugReport: string;
  dependencies: DataDependencies;
  failureModes: FailureMode[];
  topCandidate: FailureMode | null;
  latencyMs: number;
};

// ── Component locator ─────────────────────────────────────────────────────────

async function locateComponent(
  userId: string,
  bugReport: string,
  repoRoot: string
): Promise<{ filePath: string; content: string } | null> {
  // Search Spine memories for the most relevant component file
  const candidates = await rankMemories(userId, bugReport, {
    poolLimit: 20,
    limit: 5,
  }).catch(() => []);

  // Find a candidate that looks like a component (contains JSX / React)
  for (const c of candidates) {
    const src = c.source;
    if (!src) continue;
    const isComponent =
      src.endsWith('.tsx') ||
      src.endsWith('.jsx') ||
      c.content.includes('return (') ||
      c.content.includes('React.createElement');

    if (isComponent) {
      // Try to read the actual file
      const filePath = resolve(repoRoot, src);
      try {
        const content = await readFile(filePath, 'utf8');
        return { filePath: src, content };
      } catch {
        // Return memory content as proxy
        return { filePath: src, content: c.content };
      }
    }
  }

  // Last resort: try to read the file named in the bug report
  const fileMatch = bugReport.match(/[\w/.-]+\.(tsx?|jsx?|py|rb|go)/);
  if (fileMatch) {
    const guessPath = resolve(repoRoot, fileMatch[0]);
    try {
      const content = await readFile(guessPath, 'utf8');
      return { filePath: fileMatch[0], content };
    } catch { /* skip */ }
  }

  return null;
}

// ── Static dependency extractor ───────────────────────────────────────────────
// Lightweight regex-based extraction — no AST parsing, good enough for prompting

function extractStaticDependencies(source: string): DataDependencies {
  const props: string[] = [];
  const hooks: string[] = [];
  const external: string[] = [];

  // Props interface
  const propsInterfaceMatch = source.match(/(?:type|interface)\s+\w*Props\s*[={]\s*\{([^}]+)\}/s);
  if (propsInterfaceMatch) {
    const propLines = propsInterfaceMatch[1].split('\n').map((l) => l.trim()).filter(Boolean);
    props.push(...propLines.filter((l) => l.includes(':')).slice(0, 10));
  }

  // useState
  const useStateMatches = [...source.matchAll(/useState\s*(?:<[^>]+>)?\s*\(([^)]*)\)/g)];
  for (const m of useStateMatches.slice(0, 8)) {
    hooks.push(`useState(${m[1].trim().slice(0, 40)})`);
  }

  // useEffect deps
  const useEffectMatches = [...source.matchAll(/useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]*\},\s*\[([^\]]*)\]/gs)];
  for (const m of useEffectMatches.slice(0, 4)) {
    hooks.push(`useEffect([${m[1].trim()}])`);
  }

  // useContext
  const ctxMatches = [...source.matchAll(/useContext\s*\(\s*(\w+)/g)];
  for (const m of ctxMatches.slice(0, 4)) {
    hooks.push(`useContext(${m[1]})`);
  }

  // fetch
  const fetchMatches = [...source.matchAll(/fetch\s*\(\s*['"`]([^'"`]+)['"`]/g)];
  for (const m of fetchMatches.slice(0, 4)) {
    external.push(`fetch('${m[1]}')`);
  }

  // Supabase
  const supabaseMatches = [...source.matchAll(/\.from\s*\(\s*['"](\w+)['"]\s*\)\s*\.(\w+)/g)];
  for (const m of supabaseMatches.slice(0, 4)) {
    external.push(`supabase.from('${m[1]}').${m[2]}()`);
  }

  return { props, hooks, external };
}

// ── Synthesis call ────────────────────────────────────────────────────────────

async function callSimulator(
  bugReport: string,
  filePath: string,
  sourceCode: string,
  deps: DataDependencies
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  // Truncate source to stay within token budget (~3000 chars)
  const src = sourceCode.length > 3000 ? sourceCode.slice(0, 3000) + '\n// … (truncated)' : sourceCode;

  const userMsg = `Bug report: "${bugReport}"

File: ${filePath}

Extracted dependencies:
- Props: ${deps.props.join(', ') || 'none detected'}
- Hooks: ${deps.hooks.join(', ') || 'none detected'}
- External calls: ${deps.external.join(', ') || 'none detected'}

Source code:
\`\`\`tsx
${src}
\`\`\`

Enumerate failure modes and return JSON.`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: FAILURE_MODE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku simulator ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Given a natural language bug report, locate the suspect component, enumerate
 * failure modes, and return the top 3 ranked candidates with file:line pointers.
 *
 * @param userId    Spine user ID
 * @param bugReport Natural language description: "the checkout button doesn't work on mobile"
 * @param repoRoot  Local repo root path for direct file reads
 */
export async function simulateFailurePath(
  userId: string,
  bugReport: string,
  repoRoot = process.cwd()
): Promise<FailurePathResult> {
  const started = Date.now();

  const located = await locateComponent(userId, bugReport, repoRoot);

  if (!located) {
    return {
      componentName: 'Unknown',
      filePath: 'unknown',
      bugReport,
      dependencies: { props: [], hooks: [], external: [] },
      failureModes: [],
      topCandidate: null,
      latencyMs: Date.now() - started,
    };
  }

  const deps = extractStaticDependencies(located.content);
  const rawJson = await callSimulator(bugReport, located.filePath, located.content, deps);

  type ParsedResult = {
    component_name?: string;
    file_path?: string;
    dependencies?: DataDependencies;
    failure_modes?: FailureMode[];
  };

  let parsed: ParsedResult = {};
  try { parsed = JSON.parse(stripFences(rawJson)) as ParsedResult; } catch { /* fallback */ }

  const modes = (parsed.failure_modes ?? [])
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 3);

  return {
    componentName: parsed.component_name ?? located.filePath.split('/').pop() ?? 'Unknown',
    filePath: parsed.file_path ?? located.filePath,
    bugReport,
    dependencies: parsed.dependencies ?? deps,
    failureModes: modes,
    topCandidate: modes[0] ?? null,
    latencyMs: Date.now() - started,
  };
}
