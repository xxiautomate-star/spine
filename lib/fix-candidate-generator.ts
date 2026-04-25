// Fix candidate generator: for each failure mode from the simulator, reads the
// actual file, asks Haiku to generate a targeted code change, computes a unified
// diff, and validates it against the pattern library. Returns fixes ranked by
// confidence — ready to apply or present to the developer.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankMemories } from './retrieval';
import { checkPatterns } from './pattern-library';
import type { FailureMode } from './failure-path-simulator';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const FIX_SYSTEM = `You are Spine's automated fix generator.

Given a bug hypothesis and the relevant source file, produce the MINIMAL code change that fixes the root cause. Do not refactor surrounding code. Do not add features. Fix only what is broken.

Rules:
- If the bug is a missing null guard: add optional chaining or an early-return guard
- If the bug is a missing default: add a sensible default value in the right place
- If the bug is a wrong dependency array: correct only the deps array
- If the bug is a wrong type assumption: add a type guard, not a cast

Output strict JSON:
{
  "original_lines": ["<exact lines to replace — include enough context to be unambiguous>"],
  "replacement_lines": ["<the fixed lines, same indentation>"],
  "explanation": "<what changed and why this fixes the bug>",
  "confidence": <0.0 to 1.0>,
  "side_effects": ["<any other place in the codebase that may need updating>"]
}

original_lines must be a verbatim substring of the file. If you cannot produce a safe fix, set confidence to 0 and explain why.`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FixCandidate = {
  failureMode: FailureMode;
  file: string;
  diff: string;              // unified diff format
  explanation: string;
  confidence: number;        // 0-1, after pattern-library penalty applied
  rawConfidence: number;     // Haiku's pre-penalty confidence
  patternScore: number;      // from pattern-library
  patternFindings: string;   // human-readable issues found
  sideEffects: string[];
  relatedMemories: string[]; // Spine memory IDs that corroborate this fix
  applied: boolean;          // whether the fix was successfully computed
  latencyMs: number;
};

export type FixReport = {
  bugReport: string;
  candidates: FixCandidate[];
  bestFix: FixCandidate | null;
  latencyMs: number;
};

// ── Unified diff generator ─────────────────────────────────────────────────────
// Minimal implementation: find the changed range, emit one hunk.

function makeDiff(
  originalLines: string[],
  replacementLines: string[],
  filePath: string,
  startLine: number
): string {
  const a = originalLines.map((l) => `-${l}`);
  const b = replacementLines.map((l) => `+${l}`);
  const oldCount = originalLines.length;
  const newCount = replacementLines.length;

  return [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${startLine},${oldCount} +${startLine},${newCount} @@`,
    ...a,
    ...b,
  ].join('\n');
}

function findLineNumber(content: string, target: string): number {
  const lines = content.split('\n');
  // Find the first line that contains the start of target
  const firstTargetLine = target.split('\n')[0].trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(firstTargetLine)) return i + 1;
  }
  return 1;
}

function applyFix(
  fileContent: string,
  originalLines: string[],
  replacementLines: string[]
): { fixed: string; startLine: number } | null {
  const original = originalLines.join('\n');
  const idx = fileContent.indexOf(original);
  if (idx === -1) {
    // Try trimmed match
    const trimmedOrig = originalLines.map((l) => l.trimEnd()).join('\n');
    const trimmedContent = fileContent.split('\n').map((l) => l.trimEnd()).join('\n');
    const tidx = trimmedContent.indexOf(trimmedOrig);
    if (tidx === -1) return null;
    const before = fileContent.slice(0, tidx);
    const startLine = (before.match(/\n/g) ?? []).length + 1;
    const replacement = replacementLines.join('\n');
    const fixed = trimmedContent.slice(0, tidx) + replacement + trimmedContent.slice(tidx + trimmedOrig.length);
    return { fixed, startLine };
  }
  const before = fileContent.slice(0, idx);
  const startLine = (before.match(/\n/g) ?? []).length + 1;
  const replacement = replacementLines.join('\n');
  const fixed = fileContent.slice(0, idx) + replacement + fileContent.slice(idx + original.length);
  return { fixed, startLine };
}

// ── Haiku fix call ────────────────────────────────────────────────────────────

async function callFixGenerator(
  hypothesis: string,
  evidence: string,
  filePath: string,
  fileContent: string,
  errorLine: number | null
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  // Focus the source context on the area around the error line
  const lines = fileContent.split('\n');
  const start = errorLine ? Math.max(0, errorLine - 20) : 0;
  const end = errorLine ? Math.min(lines.length, errorLine + 20) : Math.min(lines.length, 60);
  const focusedSource = lines
    .slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(4)} | ${l}`)
    .join('\n');

  const userMsg = `Bug hypothesis: ${hypothesis}

Evidence from code: ${evidence}

File: ${filePath}
Relevant lines (${start + 1}–${end + 1}):
\`\`\`
${focusedSource}
\`\`\`

Generate the minimal fix as JSON.`;

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
      system: [{ type: 'text', text: FIX_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!res.ok) throw new Error(`Haiku fix ${res.status}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string) {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate fix candidates for each failure mode returned by the simulator.
 * Each fix includes a unified diff, pattern validation, confidence score,
 * and corroborating Spine memories.
 *
 * @param userId        Spine user ID
 * @param bugReport     Original bug report string
 * @param failureModes  Top failure modes from simulateFailurePath()
 * @param repoRoot      Local repo root for file reads
 */
export async function generateFixCandidates(
  userId: string,
  bugReport: string,
  failureModes: FailureMode[],
  repoRoot = process.cwd()
): Promise<FixReport> {
  const started = Date.now();

  const candidates = await Promise.all(
    failureModes.slice(0, 3).map(async (mode) => {
      const modeStart = Date.now();
      const filePath = mode.file || 'unknown';

      // ── 1. Read file ───────────────────────────────────────────────────────
      let fileContent = '';
      try {
        fileContent = await readFile(resolve(repoRoot, filePath), 'utf8');
      } catch {
        // Fall back to Spine memory for this file
        const mems = await rankMemories(userId, `${filePath} ${mode.hypothesis}`, {
          poolLimit: 6,
          limit: 2,
        }).catch(() => []);
        fileContent = mems.map((m) => m.content).join('\n\n');
      }

      // ── 2. Call Haiku for fix ──────────────────────────────────────────────
      const rawJson = await callFixGenerator(
        mode.hypothesis,
        mode.evidence,
        filePath,
        fileContent,
        mode.line
      ).catch(() => '{}');

      type ParsedFix = {
        original_lines?: string[];
        replacement_lines?: string[];
        explanation?: string;
        confidence?: number;
        side_effects?: string[];
      };

      let parsed: ParsedFix = {};
      try { parsed = JSON.parse(stripFences(rawJson)) as ParsedFix; } catch { /* skip */ }

      const rawConfidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

      const origLines = parsed.original_lines ?? [];
      const replLines = parsed.replacement_lines ?? [];

      // ── 3. Apply fix & compute diff ───────────────────────────────────────
      let diff = '';
      let applied = false;

      if (origLines.length > 0 && fileContent) {
        const result = applyFix(fileContent, origLines, replLines);
        if (result) {
          const startLine = findLineNumber(fileContent, origLines[0]);
          diff = makeDiff(origLines, replLines, filePath, startLine);
          applied = true;
        }
      }

      // Fallback diff when apply failed (Haiku gave us unusable originals)
      if (!applied && parsed.explanation) {
        diff = `--- a/${filePath}\n+++ b/${filePath}\n# (Haiku could not produce exact line match)\n# Fix direction: ${parsed.explanation}`;
      }

      // ── 4. Pattern library check ───────────────────────────────────────────
      const fixCode = replLines.join('\n');
      const patternResult = checkPatterns(fixCode);

      // ── 5. Retrieve corroborating memories ────────────────────────────────
      const relatedMems = await rankMemories(
        userId,
        `${mode.hypothesis} ${filePath}`,
        { poolLimit: 8, limit: 3 }
      ).catch(() => []);

      // ── 6. Final confidence (penalised by pattern score) ──────────────────
      const confidence = Math.round(rawConfidence * patternResult.score * 100) / 100;

      return {
        failureMode: mode,
        file: filePath,
        diff,
        explanation: parsed.explanation ?? mode.hypothesis,
        confidence,
        rawConfidence,
        patternScore: patternResult.score,
        patternFindings: patternResult.findings.length > 0
          ? patternResult.findings.map((f) => `L${f.line} ${f.rule}: ${f.message}`).join('; ')
          : 'Clean',
        sideEffects: parsed.side_effects ?? [],
        relatedMemories: relatedMems.map((m) => m.id),
        applied,
        latencyMs: Date.now() - modeStart,
      } satisfies FixCandidate;
    })
  );

  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    bugReport,
    candidates,
    bestFix: candidates[0] ?? null,
    latencyMs: Date.now() - started,
  };
}
