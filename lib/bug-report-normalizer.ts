// Bug report normalizer: converts natural language bug reports ("checkout button
// spins forever on mobile") into the structured format that failure-path-simulator
// expects. Extracts component, symptom, environment, trigger, and severity so
// non-technical reporters can feed Spine.

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const NORMALIZE_SYSTEM = `You are Spine's bug report normaliser.

Convert a raw natural language bug report into a precise, structured format for automated root cause analysis.

Rules:
- component: the UI element or code module that is broken, as specifically as possible
- symptom: what observable behaviour is wrong (not "doesn't work" — be specific)
- environment: where the bug occurs (browser, OS, device, account type, data condition)
- trigger: the exact user action or system event that causes the bug
- frequency: always | sometimes | once | unknown
- severity: critical (data loss/security) | high (feature broken) | medium (degraded) | low (cosmetic)
- hypothesis_category: one of:
    async         — stuck loading, never resolves, spinner forever
    state         — wrong/stale data displayed, state not reset
    render-error  — component crashes during render
    network       — API call fails, timeout, wrong response
    auth          — permission, session, redirect issues
    validation    — form/input rejection, wrong error message
    performance   — slow, laggy, unresponsive (not crashed)
    style         — visual-only, data is correct
- structured_query: a precise one-sentence query for Spine's retrieval system that
  will find the most relevant code (use component name + symptom + likely code patterns)

Output strict JSON:
{
  "raw_report": "<original text verbatim>",
  "component": "<specific UI component or code module>",
  "symptom": "<precise observable behaviour>",
  "environment": {
    "platform": "<web | ios | android | all>",
    "device": "<mobile | desktop | tablet | unknown>",
    "condition": "<data condition that triggers it, or null>"
  },
  "trigger": "<exact user action or system event>",
  "frequency": "always | sometimes | once | unknown",
  "severity": "critical | high | medium | low",
  "hypothesis_category": "<category from the list>",
  "structured_query": "<retrieval query>",
  "additional_context": ["<implied context not stated in the report>"]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BugEnvironment = {
  platform: 'web' | 'ios' | 'android' | 'all';
  device: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  condition: string | null;
};

export type NormalizedBug = {
  raw_report: string;
  component: string;
  symptom: string;
  environment: BugEnvironment;
  trigger: string;
  frequency: 'always' | 'sometimes' | 'once' | 'unknown';
  severity: 'critical' | 'high' | 'medium' | 'low';
  hypothesis_category:
    | 'async' | 'state' | 'render-error' | 'network'
    | 'auth' | 'validation' | 'performance' | 'style';
  structured_query: string;
  additional_context: string[];
};

// ── Normalizer call ───────────────────────────────────────────────────────────

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

async function callNormalizer(rawReport: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: NORMALIZE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Bug report: "${rawReport}"` }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku normalizer ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Normalize a raw natural language bug report into structured format.
 * Returns a NormalizedBug ready for failure-path-simulator.
 */
export async function normalizeBugReport(rawReport: string): Promise<NormalizedBug> {
  const rawJson = await callNormalizer(rawReport.trim());

  let parsed: Partial<NormalizedBug> = {};
  try {
    parsed = JSON.parse(stripFences(rawJson)) as Partial<NormalizedBug>;
  } catch {
    // Fallback: best-effort extraction
    parsed = {
      component: 'Unknown component',
      symptom: rawReport,
      hypothesis_category: 'async',
    };
  }

  return {
    raw_report: parsed.raw_report ?? rawReport,
    component: parsed.component ?? 'Unknown component',
    symptom: parsed.symptom ?? rawReport,
    environment: parsed.environment ?? { platform: 'web', device: 'unknown', condition: null },
    trigger: parsed.trigger ?? 'User interaction',
    frequency: parsed.frequency ?? 'unknown',
    severity: parsed.severity ?? 'medium',
    hypothesis_category: parsed.hypothesis_category ?? 'async',
    structured_query: parsed.structured_query ?? rawReport,
    additional_context: parsed.additional_context ?? [],
  };
}

/**
 * Convert a NormalizedBug into the natural-language query string that
 * failure-path-simulator.simulateFailurePath() accepts as its bugReport param.
 */
export function toSimulatorQuery(bug: NormalizedBug): string {
  const env = [
    bug.environment.device !== 'unknown' ? bug.environment.device : null,
    bug.environment.condition,
  ]
    .filter(Boolean)
    .join(', ');

  const parts = [
    `${bug.component}: ${bug.symptom}`,
    bug.trigger ? `Triggered by: ${bug.trigger}` : null,
    env ? `Environment: ${env}` : null,
    `Category: ${bug.hypothesis_category}`,
  ].filter(Boolean);

  return parts.join('. ');
}
