// Screenshot reasoner: accepts a broken-UI screenshot (base64 or URL), uses
// Claude vision to extract error text, identify the broken component, and spot
// missing states. Converts vision findings into the structured format that
// trace-reasoner + failure-path-simulator expect — so dropping a screenshot
// triggers the full debugging pipeline automatically.

import { rankMemories } from './retrieval';

// ── Constants ─────────────────────────────────────────────────────────────────

// Sonnet 4.6 for vision — better at reading UI than Haiku
const VISION_MODEL = 'claude-sonnet-4-6';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const VISION_SYSTEM = `You are Spine's visual bug analyser.

You receive a screenshot of a broken, loading, or incorrect UI. Your job is to:

1. Extract any visible error text verbatim (console errors, toast messages, error boundaries, HTTP status codes, empty states that say "Error" or "Failed")

2. Identify the broken component:
   - What is the page/route? (look for URL bar, breadcrumbs, page title)
   - Which specific UI element is broken? (button, form, table, chart, modal, list)
   - What is the component's apparent purpose? (submit form, load data, navigate, display list)

3. Identify missing or wrong states:
   - Is a loading spinner running when data should be there?
   - Is there an empty state where data should show?
   - Is a button disabled/grayed that should be active?
   - Is layout broken (overflow, z-index, invisible elements)?
   - Is there a mismatch between UI state and expected state?

4. Infer the trigger: what user action likely caused this state?

5. Classify the bug category:
   - async/loading: data never arrived or request is stuck
   - render-error: component threw during render
   - state-corruption: UI shows wrong/stale data
   - style/layout: visual-only, logic is fine
   - network: API call failed (look for 404, 500, network errors)
   - auth: permission error, redirect loop, session expired

Output strict JSON:
{
  "error_text": "<verbatim error text visible, or null>",
  "page_or_route": "<inferred URL path or page name>",
  "broken_component": "<specific component/element description>",
  "component_purpose": "<what this component is supposed to do>",
  "missing_states": ["<state that should be present but isn't>"],
  "visible_symptoms": ["<observable symptom 1>", "<symptom 2>"],
  "inferred_trigger": "<user action that caused this>",
  "bug_category": "async | render-error | state-corruption | style | network | auth",
  "severity": "critical | high | medium | low",
  "synthetic_bug_report": "<one sentence natural language bug report suitable for the failure-path-simulator>",
  "synthetic_stack_hint": "<if error text is visible, format it as: ErrorType: message — or null>"
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type BugCategory = 'async' | 'render-error' | 'state-corruption' | 'style' | 'network' | 'auth';

export type ScreenshotAnalysis = {
  errorText: string | null;
  pageOrRoute: string;
  brokenComponent: string;
  componentPurpose: string;
  missingStates: string[];
  visibleSymptoms: string[];
  inferredTrigger: string;
  bugCategory: BugCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  syntheticBugReport: string;
  syntheticStackHint: string | null;
  // enriched after vision — corroborating Spine memories
  relatedMemories: Array<{ content: string; source: string | null }>;
  latencyMs: number;
};

// ── Image normaliser ─────────────────────────────────────────────────────────

type ImageSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string };

async function normaliseImage(input: string): Promise<ImageSource> {
  // Plain base64 data URI: "data:image/png;base64,iVBOR..."
  const dataUriMatch = input.match(/^data:(image\/\w+);base64,(.+)$/s);
  if (dataUriMatch) {
    return { type: 'base64', mediaType: dataUriMatch[1], data: dataUriMatch[2] };
  }

  // Raw base64 without data URI prefix — assume PNG
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 200) {
    return { type: 'base64', mediaType: 'image/png', data: input };
  }

  // URL — fetch and convert to base64 so we can pass it to the API consistently
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const res = await fetch(input, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Failed to fetch screenshot: ${res.status}`);
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const buffer = await res.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');
    return { type: 'base64', mediaType: contentType.split(';')[0], data: b64 };
  }

  throw new Error('Unrecognised image input — expected base64, data URI, or https:// URL');
}

// ── Vision call ───────────────────────────────────────────────────────────────

async function callVision(image: ImageSource): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const imageContent =
    image.type === 'base64'
      ? { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }
      : { type: 'image', source: { type: 'url', url: image.url } };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: VISION_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            imageContent,
            { type: 'text', text: 'Analyse this screenshot and return the JSON.' },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vision API ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a UI screenshot and extract structured debugging information.
 * Then enriches with corroborating Spine memories for the identified component.
 *
 * @param userId  Spine user ID (for memory enrichment)
 * @param input   Base64 string, data URI, or https:// URL of the screenshot
 */
export async function reasonScreenshot(
  userId: string,
  input: string
): Promise<ScreenshotAnalysis> {
  const started = Date.now();

  const image = await normaliseImage(input);
  const rawJson = await callVision(image);

  type ParsedVision = {
    error_text?: string | null;
    page_or_route?: string;
    broken_component?: string;
    component_purpose?: string;
    missing_states?: string[];
    visible_symptoms?: string[];
    inferred_trigger?: string;
    bug_category?: BugCategory;
    severity?: 'critical' | 'high' | 'medium' | 'low';
    synthetic_bug_report?: string;
    synthetic_stack_hint?: string | null;
  };

  let parsed: ParsedVision = {};
  try {
    parsed = JSON.parse(stripFences(rawJson)) as ParsedVision;
  } catch {
    // Best-effort fallback
    parsed = {
      synthetic_bug_report: 'UI appears broken — could not parse screenshot analysis',
      bug_category: 'render-error',
      severity: 'high',
    };
  }

  // Enrich with Spine memories relevant to the broken component
  const searchQuery = [
    parsed.broken_component ?? '',
    parsed.page_or_route ?? '',
    parsed.component_purpose ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const relatedCandidates = searchQuery
    ? await rankMemories(userId, searchQuery, { poolLimit: 10, limit: 4 }).catch(() => [])
    : [];

  return {
    errorText: parsed.error_text ?? null,
    pageOrRoute: parsed.page_or_route ?? 'unknown',
    brokenComponent: parsed.broken_component ?? 'unknown component',
    componentPurpose: parsed.component_purpose ?? '',
    missingStates: parsed.missing_states ?? [],
    visibleSymptoms: parsed.visible_symptoms ?? [],
    inferredTrigger: parsed.inferred_trigger ?? '',
    bugCategory: parsed.bug_category ?? 'render-error',
    severity: parsed.severity ?? 'high',
    syntheticBugReport: parsed.synthetic_bug_report ?? 'UI bug detected from screenshot',
    syntheticStackHint: parsed.synthetic_stack_hint ?? null,
    relatedMemories: relatedCandidates.map((c) => ({ content: c.content, source: c.source })),
    latencyMs: Date.now() - started,
  };
}
