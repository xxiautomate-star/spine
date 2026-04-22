// Repro instruction generator: given the traced failure path + top fix candidate,
// produces step-by-step reproduction steps that Roman can follow to verify the
// bug exists before applying any fix.
//
// Output format: numbered steps with setup, navigation, state manipulation,
// event trigger, and expected observation — enough to reproduce from a fresh tab.

import type { TraceResult } from './trace-reasoner';
import type { FailurePathResult } from './failure-path-simulator';
import type { FixCandidate } from './fix-candidate-generator';

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const REPRO_SYSTEM = `You are Spine's reproduction instruction writer.

Given a bug trace, failure path analysis, and the top fix candidate, write clear step-by-step reproduction instructions that a developer can follow to verify the bug exists before applying the fix.

Instructions must be:
- Concrete and specific — "open X" not "navigate to the component"
- Include any required state setup (local storage, cookies, specific props, database state)
- Include the exact user action that triggers the bug
- Include the exact expected vs actual behaviour
- Include how to verify the fix worked

Output strict JSON:
{
  "title": "<short bug title>",
  "environment": {
    "url_or_command": "<localhost:3000/path or 'npm run dev'",
    "browser": "<Chrome | Firefox | Safari | Mobile>",
    "prerequisites": ["<any required setup>"]
  },
  "steps": [
    {
      "step": 1,
      "action": "<exact thing to do>",
      "expected": "<what should happen>",
      "actual": "<what actually happens (the bug)>",
      "is_bug_trigger": true
    }
  ],
  "verification": {
    "console_error": "<exact error message to look for>",
    "visual_symptom": "<what you see on screen>",
    "fix_verification": "<how to confirm the fix worked>"
  },
  "minimal_repro": "<one-liner description of the absolute minimal repro case>",
  "affected_environments": ["<prod | staging | local | mobile | desktop>"]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReproStep = {
  step: number;
  action: string;
  expected: string;
  actual: string;
  is_bug_trigger: boolean;
};

export type ReproEnvironment = {
  url_or_command: string;
  browser: string;
  prerequisites: string[];
};

export type ReproVerification = {
  console_error: string;
  visual_symptom: string;
  fix_verification: string;
};

export type ReproInstructions = {
  title: string;
  environment: ReproEnvironment;
  steps: ReproStep[];
  verification: ReproVerification;
  minimal_repro: string;
  affected_environments: string[];
  formatted: string;   // human-readable markdown version
  latencyMs: number;
};

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatInstructions(raw: Partial<ReproInstructions>): string {
  const lines: string[] = [];

  lines.push(`# ${raw.title ?? 'Bug Reproduction'}`);
  lines.push('');

  if (raw.environment) {
    lines.push('## Environment');
    lines.push(`- **Run**: \`${raw.environment.url_or_command}\``);
    lines.push(`- **Browser**: ${raw.environment.browser}`);
    if (raw.environment.prerequisites?.length) {
      lines.push('- **Prerequisites**:');
      raw.environment.prerequisites.forEach((p) => lines.push(`  - ${p}`));
    }
    lines.push('');
  }

  if (raw.steps?.length) {
    lines.push('## Steps to reproduce');
    for (const s of raw.steps) {
      lines.push(`${s.step}. **${s.action}**`);
      if (s.is_bug_trigger) {
        lines.push(`   - Expected: ${s.expected}`);
        lines.push(`   - **Actual (bug): ${s.actual}**`);
      }
    }
    lines.push('');
  }

  if (raw.verification) {
    lines.push('## Verification');
    if (raw.verification.console_error) {
      lines.push(`- **Console**: \`${raw.verification.console_error}\``);
    }
    if (raw.verification.visual_symptom) {
      lines.push(`- **Visual**: ${raw.verification.visual_symptom}`);
    }
    if (raw.verification.fix_verification) {
      lines.push(`- **Fix check**: ${raw.verification.fix_verification}`);
    }
    lines.push('');
  }

  if (raw.minimal_repro) {
    lines.push('## Minimal repro');
    lines.push(raw.minimal_repro);
    lines.push('');
  }

  if (raw.affected_environments?.length) {
    lines.push(`**Affects**: ${raw.affected_environments.join(', ')}`);
  }

  return lines.join('\n');
}

// ── Synthesis call ────────────────────────────────────────────────────────────

async function callReproGenerator(
  traceResult: TraceResult,
  failurePath: FailurePathResult,
  topFix: FixCandidate | null
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const errorSite = traceResult.errorSite;
  const rootCause = traceResult.rootCauseFrame;
  const topMode = failurePath.topCandidate;

  const userMsg = `Error: ${traceResult.errorType}: ${traceResult.errorMessage}

Error site: ${errorSite?.file ?? 'unknown'}:${errorSite?.line ?? '?'} in ${errorSite?.functionName ?? 'anonymous'}

Root cause frame: ${rootCause?.file ?? 'unknown'}:${rootCause?.line ?? '?'} in ${rootCause?.functionName ?? 'anonymous'}

Data flow:
${traceResult.dataFlow.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Top failure mode hypothesis:
${topMode?.hypothesis ?? 'Unknown'}
Evidence: ${topMode?.evidence ?? 'None'}

Fix direction: ${topFix?.explanation ?? traceResult.fixHint ?? 'Unknown'}
Fix file: ${topFix?.file ?? 'Unknown'}

Component: ${failurePath.componentName}
Props: ${failurePath.dependencies.props.slice(0, 5).join(', ')}
Hooks: ${failurePath.dependencies.hooks.slice(0, 5).join(', ')}

Generate reproduction instructions.`;

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
      system: [{ type: 'text', text: REPRO_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku repro ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate step-by-step reproduction instructions from a completed debug session.
 *
 * Combines trace analysis, failure path, and the top fix candidate to produce
 * instructions specific enough that Roman can follow them without context.
 */
export async function generateReproInstructions(
  traceResult: TraceResult,
  failurePath: FailurePathResult,
  topFix: FixCandidate | null
): Promise<ReproInstructions> {
  const started = Date.now();

  const rawJson = await callReproGenerator(traceResult, failurePath, topFix).catch(
    () => '{}'
  );

  type Parsed = Omit<ReproInstructions, 'formatted' | 'latencyMs'>;
  let parsed: Partial<Parsed> = {};
  try { parsed = JSON.parse(stripFences(rawJson)) as Partial<Parsed>; } catch { /* fallback */ }

  const result: ReproInstructions = {
    title: parsed.title ?? `${traceResult.errorType} in ${traceResult.errorSite?.functionName ?? 'unknown'}`,
    environment: parsed.environment ?? {
      url_or_command: 'npm run dev → localhost:3000',
      browser: 'Chrome DevTools',
      prerequisites: [],
    },
    steps: parsed.steps ?? [
      {
        step: 1,
        action: `Open ${traceResult.errorSite?.file ?? 'the component'} in the browser`,
        expected: 'Component renders normally',
        actual: `${traceResult.errorType}: ${traceResult.errorMessage}`,
        is_bug_trigger: true,
      },
    ],
    verification: parsed.verification ?? {
      console_error: `${traceResult.errorType}: ${traceResult.errorMessage}`,
      visual_symptom: 'Component fails to render',
      fix_verification: 'Component renders without console errors',
    },
    minimal_repro: parsed.minimal_repro ?? traceResult.fixHint,
    affected_environments: parsed.affected_environments ?? ['local', 'prod'],
    formatted: '',
    latencyMs: Date.now() - started,
  };

  result.formatted = formatInstructions(result);
  return result;
}

/**
 * Run the full debug pipeline end-to-end and return a complete session report.
 * Convenience wrapper that chains reasonTrace → simulateFailurePath →
 * generateFixCandidates → generateReproInstructions.
 */
export type FullDebugSession = {
  traceResult: TraceResult;
  failurePath: FailurePathResult;
  fixes: import('./fix-candidate-generator').FixReport;
  reproInstructions: ReproInstructions;
  totalLatencyMs: number;
};
