// Weekly multi-session digest rollup.
//
// Pulls all kind='digest' rows in a target ISO week, asks Haiku to roll
// them up into a single artifact (themes + decisions + open threads +
// commits referenced), and stores the result as one memory row tagged
// kind='weekly_digest'. Always embedded — this is the public artifact
// the user posts on HN/Reddit/X.
//
// Idempotent on (user_id, ISO week): a second call for the same week
// returns the existing row without re-running the LLM.
//
// Cost guardrails:
//   - Hard-skip if free-tier capacity would be exceeded by inserting the
//     row. Returns { ok: false, skipped: 'cap_exhausted' } — never crashes.
//   - LLM failure (rate limit, network) stores an error payload row so
//     the caller sees what happened. The user's cap takes a hit; price
//     of transparency.
//   - Token budget capped at 50k input tokens (~200k chars). If exceeded,
//     run two-pass summarisation: chunk halves → summarise each → roll
//     summaries into the final.

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedManyWithMeta } from './embeddings';
import { captureCap, isUnlimited, type Plan } from './plan-limits';

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// 50k input-token budget per the brief. Approx 4 chars/token → 200k chars.
const INPUT_CHAR_BUDGET = 200_000;

// ── Types ────────────────────────────────────────────────────────────────────

export type WeeklyDigestPayload = {
  themes: string[];
  decisions: string[];
  open_threads: string[];
  commits: string[];
  session_count: number;
  generated_at: string;
};

export type WeeklyDigestResult =
  | {
      ok: true;
      id: string;
      week: string;
      cached: boolean;
      payload: WeeklyDigestPayload;
      coverageWindow: { start: string; end: string };
    }
  | {
      ok: false;
      week: string;
      skipped: 'cap_exhausted' | 'no_digests' | 'llm_error';
      error?: string;
      coverageWindow?: { start: string; end: string };
    };

type DigestRow = {
  id: string;
  content: string;
  session_id: string | null;
  created_at: string;
  files_touched: string[] | null;
};

// ── ISO week helpers ─────────────────────────────────────────────────────────

/**
 * Convert a Date to ISO 8601 week string "YYYY-WW".
 * Week containing Thu Jan 4 = W01 (ISO 8601). Monday is week start.
 * All math in UTC.
 */
export function isoWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Make Thursday of the same ISO-week the anchor (Monday=1 ... Sunday=7).
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Resolve a YYYY-WW string to its UTC Mon 00:00:00 → Sun 23:59:59 window.
 */
export function weekWindow(weekStr: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekStr);
  if (!m) throw new Error(`Invalid ISO week string: ${weekStr}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  // Jan 4 is always in W01 of its ISO-week year.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const w01Monday = new Date(jan4);
  w01Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const start = new Date(w01Monday);
  start.setUTCDate(w01Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * The most recent COMPLETE ISO week before the given date.
 * Default target when the caller didn't specify --week — we never roll
 * up the in-flight current week.
 */
export function lastCompleteWeek(now: Date = new Date()): string {
  const oneWeekAgo = new Date(now.getTime() - 7 * 86_400_000);
  return isoWeekOf(oneWeekAgo);
}

// ── Haiku call ───────────────────────────────────────────────────────────────

const SYSTEM = `You are the weekly memory analyst for Spine, an append-only AI memory layer.

You receive end-of-session digests from a single user across one ISO week.
Your job: roll them up into one weekly artifact suitable for posting on
Hacker News / Reddit / X as a build-in-public update.

CRITICAL RULES:
- Themes are the threads that ran across multiple sessions ("vector recall
  rewrite" not "worked on backend").
- Decisions must capture verbatim what was locked, killed, or shipped —
  preserve specifics.
- Open threads list unfinished work pulled forward to next week.
- Commits list git commits referenced in any digest's commits[] array.
- Return STRICT JSON ONLY. No prose, no markdown, no code fences.

JSON shape:
{
  "themes": ["<short specific phrase>", ...],          // up to 5
  "decisions": ["<verbatim phrasing of the choice>", ...], // up to 8
  "open_threads": ["<unfinished work>", ...],          // up to 5
  "commits": ["<sha7> <subject>", ...]                 // up to 20, dedupe
}`;

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function flattenDigests(digests: DigestRow[]): string {
  return digests
    .map((d, i) => {
      const date = d.created_at.slice(0, 10);
      const session = d.session_id ? d.session_id.slice(0, 8) : '????????';
      return `[${i + 1}] ${date} session ${session}\n${d.content}`;
    })
    .join('\n\n---\n\n');
}

async function callHaikuOnce(payload: string): Promise<Partial<WeeklyDigestPayload>> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured.');

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
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: payload }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Haiku weekly-digest ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = data.content.find((b) => b.type === 'text')?.text ?? '{}';
  return JSON.parse(stripFences(text)) as Partial<WeeklyDigestPayload>;
}

function shape(parsed: Partial<WeeklyDigestPayload>, sessionCount: number): WeeklyDigestPayload {
  const arr = (k: unknown, max: number): string[] =>
    Array.isArray(k) ? k.filter((s): s is string => typeof s === 'string').slice(0, max) : [];
  return {
    themes: arr(parsed.themes, 5),
    decisions: arr(parsed.decisions, 8),
    open_threads: arr(parsed.open_threads, 5),
    commits: [...new Set(arr(parsed.commits, 40))].slice(0, 20),
    session_count: sessionCount,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Two-pass summariser: split the input in halves, summarise each,
 * combine the two summaries into the final weekly digest.
 */
async function callHaikuTwoPass(
  digests: DigestRow[]
): Promise<Partial<WeeklyDigestPayload>> {
  const half = Math.ceil(digests.length / 2);
  const a = digests.slice(0, half);
  const b = digests.slice(half);

  const [partialA, partialB] = await Promise.all([
    callHaikuOnce(`PARTIAL DIGESTS — first half of week (${a.length} sessions):\n\n${flattenDigests(a)}\n\nReturn the partial digest JSON for these sessions.`),
    callHaikuOnce(`PARTIAL DIGESTS — second half of week (${b.length} sessions):\n\n${flattenDigests(b)}\n\nReturn the partial digest JSON for these sessions.`),
  ]);

  const combined = `PASS-2 ROLLUP — combine these two partial weekly digests into one final artifact.

PARTIAL A (first half of week):
${JSON.stringify(partialA, null, 2)}

PARTIAL B (second half of week):
${JSON.stringify(partialB, null, 2)}

Dedupe themes / decisions / commits across the two halves. Return the final digest JSON.`;

  return callHaikuOnce(combined);
}

// ── Public entry point ──────────────────────────────────────────────────────

export type GenerateOpts = {
  week?: string; // 'YYYY-WW'. Defaults to last complete week.
  force?: boolean; // Bypass idempotency cache.
};

export async function generateWeeklyDigest(
  sb: SupabaseClient,
  userId: string,
  orgId: string | null,
  plan: Plan,
  opts: GenerateOpts = {}
): Promise<WeeklyDigestResult> {
  const week = opts.week ?? lastCompleteWeek();
  const window = weekWindow(week);

  // ── Idempotency: return cached row if one exists for this week ────────────
  if (!opts.force) {
    const { data: existing } = await sb
      .from('memories')
      .select('id, content, coverage_window')
      .eq('user_id', userId)
      .eq('kind', 'weekly_digest')
      .filter('coverage_window->>start', 'eq', window.start)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const row = existing as { id: string; content: string; coverage_window: { start: string; end: string } };
      let payload: WeeklyDigestPayload;
      try {
        payload = JSON.parse(row.content) as WeeklyDigestPayload;
      } catch {
        payload = {
          themes: [],
          decisions: [],
          open_threads: [],
          commits: [],
          session_count: 0,
          generated_at: '',
        };
      }
      return { ok: true, id: row.id, week, cached: true, payload, coverageWindow: row.coverage_window };
    }
  }

  // ── Plan cap check — never punish the user for an automated rollup ───────
  if (!isUnlimited(plan)) {
    const { count } = await sb
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null);
    const used = count ?? 0;
    if (used >= captureCap(plan)) {
      return { ok: false, week, skipped: 'cap_exhausted', coverageWindow: window };
    }
  }

  // ── Pull digests in window ───────────────────────────────────────────────
  const { data: digestsRaw } = await sb
    .from('memories')
    .select('id, content, session_id, created_at, files_touched')
    .eq('user_id', userId)
    .eq('kind', 'digest')
    .is('deleted_at', null)
    .gte('created_at', window.start)
    .lte('created_at', window.end)
    .order('created_at', { ascending: true })
    .limit(200);
  const digests = (digestsRaw ?? []) as DigestRow[];

  if (digests.length === 0) {
    return { ok: false, week, skipped: 'no_digests', coverageWindow: window };
  }

  // ── LLM call (one-pass or two-pass depending on payload size) ────────────
  let parsed: Partial<WeeklyDigestPayload> = {};
  let llmError: string | null = null;

  try {
    const flat = flattenDigests(digests);
    if (flat.length <= INPUT_CHAR_BUDGET) {
      parsed = await callHaikuOnce(
        `WEEK ${week} — ${digests.length} session digests:\n\n${flat}\n\nReturn the weekly digest JSON.`
      );
    } else {
      parsed = await callHaikuTwoPass(digests);
    }
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
  }

  const payload = llmError
    ? {
        themes: [],
        decisions: [],
        open_threads: [],
        commits: [],
        session_count: digests.length,
        generated_at: new Date().toISOString(),
      }
    : shape(parsed, digests.length);

  // ── Embed + insert ───────────────────────────────────────────────────────
  const bodyText = JSON.stringify(payload, null, 2);
  const tags = ['weekly-digest', `week:${week}`];

  let embedding: number[] | null = null;
  let embedProvider: string | null = null;
  let embedModel: string | null = null;
  let embedDims: number | null = null;
  try {
    const result = await embedManyWithMeta([bodyText.slice(0, 8000)]);
    embedding = result.vectors[0];
    embedProvider = result.provider;
    embedModel = result.model;
    embedDims = result.dims;
  } catch {
    // Non-fatal — store the row without an embedding rather than fail.
  }

  const errorPayload = llmError
    ? { error: llmError, fallback: 'no_summary_generated' }
    : null;

  const insertRow = {
    user_id: userId,
    org_id: orgId,
    content: bodyText,
    source: 'weekly-digest-job',
    tags,
    type: 'context',
    embedding,
    embed_provider: embedProvider,
    embed_model: embedModel,
    embed_dims: embedDims,
    mime: 'application/json',
    kind: 'weekly_digest',
    coverage_window: window,
    files_touched: [...new Set(digests.flatMap((d) => d.files_touched ?? []))].slice(0, 100),
    ...(errorPayload ? { caption: JSON.stringify(errorPayload) } : {}),
  };

  const { data: inserted, error: insertErr } = await sb
    .from('memories')
    .insert(insertRow)
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      week,
      skipped: 'llm_error',
      error: insertErr?.message ?? 'Insert failed',
      coverageWindow: window,
    };
  }

  if (llmError) {
    return {
      ok: false,
      week,
      skipped: 'llm_error',
      error: llmError,
      coverageWindow: window,
    };
  }

  return {
    ok: true,
    id: (inserted as { id: string }).id,
    week,
    cached: false,
    payload,
    coverageWindow: window,
  };
}

// ── Markdown formatter (used by /sessions/weekly + the CLI stdout) ──────────

export function formatWeeklyDigestMarkdown(week: string, payload: WeeklyDigestPayload): string {
  const lines: string[] = [];
  lines.push(`# Spine — week ${week}`);
  lines.push('');
  lines.push(`**${payload.session_count} session${payload.session_count === 1 ? '' : 's'}** · generated ${payload.generated_at.slice(0, 10)}`);
  lines.push('');
  if (payload.themes.length > 0) {
    lines.push('## Themes');
    for (const t of payload.themes) lines.push(`- ${t}`);
    lines.push('');
  }
  if (payload.decisions.length > 0) {
    lines.push('## Decisions');
    for (const d of payload.decisions) lines.push(`- ${d}`);
    lines.push('');
  }
  if (payload.open_threads.length > 0) {
    lines.push('## Open threads');
    for (const o of payload.open_threads) lines.push(`- ${o}`);
    lines.push('');
  }
  if (payload.commits.length > 0) {
    lines.push('## Commits');
    for (const c of payload.commits) lines.push(`- \`${c}\``);
    lines.push('');
  }
  return lines.join('\n').trim();
}
