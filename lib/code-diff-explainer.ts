// Code diff explainer: fetches a GitHub diff (PR or commit), parses it into
// semantic hunks, retrieves related Spine context for each hunk, then generates
// a natural-language explanation that cites both the diff and past context.
//
// Useful during code review: paste the GitHub URL, get "this changes X,
// here's what Spine remembers about the same files/patterns across your repos."

import { rankMemories } from './retrieval';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_HUNKS = 10;       // cap so the prompt stays manageable
const CONTEXT_PER_HUNK = 2; // memories to retrieve per hunk

const EXPLAIN_SYSTEM = `You are Spine's code review assistant.

You receive a parsed git diff (as structured hunks) and relevant memory excerpts retrieved from the developer's indexed repositories. Your job is to produce a natural-language explanation of the diff that:

1. Summarises WHAT each changed file/section does in plain English.
2. Explains WHY this change likely happened, using both the diff context and any retrieved memories that reference the same files, packages, or patterns.
3. Identifies POTENTIAL IMPACT — what else in the codebase might be affected, based on memory evidence.
4. Flags RISKS — breaking changes, missing tests, auth surface changes, perf regressions.

When citing a retrieved memory, use the format [memory: source] where source is the file path or session label.

Output strict JSON:
{
  "summary": "<2-4 sentence overall summary of what this diff does>",
  "hunk_explanations": [
    {
      "file": "<filename>",
      "change_type": "added | modified | deleted | renamed",
      "explanation": "<what changed and why, with memory citations if relevant>",
      "impact": "<what this could affect>",
      "risks": ["<specific risk if any>"]
    }
  ],
  "related_context": [
    {
      "memory_source": "<source label>",
      "excerpt": "<relevant quote under 100 chars>",
      "connection": "<why this memory is relevant to the diff>"
    }
  ],
  "overall_risk": "low | medium | high",
  "reviewer_checklist": ["<specific thing to verify during review>"]
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type Hunk = {
  file: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  oldFile?: string;
  additions: number;
  deletions: number;
  context: string; // the diff text for this file, truncated to ~800 chars
};

export type HunkExplanation = {
  file: string;
  change_type: string;
  explanation: string;
  impact: string;
  risks: string[];
};

export type RelatedContext = {
  memory_source: string;
  excerpt: string;
  connection: string;
};

export type DiffExplanation = {
  summary: string;
  hunk_explanations: HunkExplanation[];
  related_context: RelatedContext[];
  overall_risk: 'low' | 'medium' | 'high';
  reviewer_checklist: string[];
  diff_url: string;
  files_changed: number;
  latencyMs: number;
};

// ── GitHub diff fetcher ───────────────────────────────────────────────────────

type ParsedGitHubUrl = {
  owner: string;
  repo: string;
  type: 'pr' | 'commit' | 'compare';
  ref: string; // PR number or commit SHA
};

function parseGitHubUrl(url: string): ParsedGitHubUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('github.com')) return null;

    const parts = u.pathname.replace(/^\//, '').split('/');
    if (parts.length < 4) return null;

    const [owner, repo, type, ref] = parts;

    if (type === 'pull') return { owner, repo, type: 'pr', ref };
    if (type === 'commit') return { owner, repo, type: 'commit', ref };
    if (type === 'compare') return { owner, repo, type: 'compare', ref };

    return null;
  } catch {
    return null;
  }
}

async function fetchDiff(parsed: ParsedGitHubUrl): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.diff',
    'User-Agent': 'spine-diff-explainer/1.0',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let apiUrl: string;
  if (parsed.type === 'pr') {
    apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.ref}`;
  } else {
    apiUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${parsed.ref}`;
  }

  const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  return res.text();
}

// ── Diff parser ───────────────────────────────────────────────────────────────

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/m;
const HUNK_HEADER = /^@@ /m;

function parseDiff(raw: string): Hunk[] {
  const hunks: Hunk[] = [];
  // Split on "diff --git" boundaries
  const fileSections = raw.split(/^(?=diff --git )/m).filter(Boolean);

  for (const section of fileSections.slice(0, MAX_HUNKS)) {
    const headerMatch = FILE_HEADER.exec(section);
    if (!headerMatch) continue;

    const [, fileA, fileB] = headerMatch;
    let changeType: Hunk['changeType'] = 'modified';

    if (section.includes('\nnew file mode')) changeType = 'added';
    else if (section.includes('\ndeleted file mode')) changeType = 'deleted';
    else if (fileA !== fileB) changeType = 'renamed';

    const lines = section.split('\n');
    let additions = 0;
    let deletions = 0;
    const diffLines: string[] = [];
    let inHunk = false;

    for (const line of lines) {
      if (HUNK_HEADER.test(line)) { inHunk = true; diffLines.push(line); continue; }
      if (!inHunk) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) { additions++; diffLines.push(line); }
      else if (line.startsWith('-') && !line.startsWith('---')) { deletions++; diffLines.push(line); }
      else { diffLines.push(line); }
    }

    // Truncate diff context to ~800 chars for the prompt
    const context = diffLines.join('\n').slice(0, 800);

    hunks.push({
      file: fileB,
      changeType,
      oldFile: fileA !== fileB ? fileA : undefined,
      additions,
      deletions,
      context,
    });
  }

  return hunks;
}

// ── Synthesis call ────────────────────────────────────────────────────────────

function buildExplainPrompt(
  hunks: Hunk[],
  retrievedContexts: Array<{ hunkFile: string; memories: Array<{ content: string; source: string | null }> }>
): string {
  const sections: string[] = ['=== DIFF HUNKS ==='];

  for (const hunk of hunks) {
    sections.push(
      `File: ${hunk.file} (${hunk.changeType}, +${hunk.additions}/-${hunk.deletions})\n${hunk.context}`
    );
  }

  sections.push('\n=== RELATED SPINE CONTEXT ===');

  for (const { hunkFile, memories } of retrievedContexts) {
    if (memories.length === 0) continue;
    sections.push(`Context for ${hunkFile}:`);
    for (const m of memories) {
      const src = m.source ?? 'unknown';
      const body = m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content;
      sections.push(`  [memory: ${src}]\n  ${body}`);
    }
  }

  sections.push('\nReturn JSON explanation:');
  return sections.join('\n\n');
}

async function callExplain(prompt: string): Promise<string> {
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
      max_tokens: 2048,
      system: [{ type: 'text', text: EXPLAIN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Haiku explain ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a GitHub diff, parse it into hunks, retrieve related Spine context,
 * and generate a natural-language code review explanation.
 *
 * Requires GITHUB_TOKEN (optional but recommended to avoid rate limits) and
 * ANTHROPIC_API_KEY env vars.
 *
 * @param userId   Spine user ID
 * @param diffUrl  GitHub PR URL, commit URL, or compare URL
 */
export async function explainDiff(userId: string, diffUrl: string): Promise<DiffExplanation> {
  const started = Date.now();

  const parsed = parseGitHubUrl(diffUrl);
  if (!parsed) {
    throw new Error(`Unrecognised GitHub URL: ${diffUrl}. Expected a PR, commit, or compare URL.`);
  }

  // ── 1. Fetch raw diff ──────────────────────────────────────────────────────
  const rawDiff = await fetchDiff(parsed);

  // ── 2. Parse into hunks ────────────────────────────────────────────────────
  const hunks = parseDiff(rawDiff);
  if (hunks.length === 0) {
    throw new Error('No parseable diff hunks found in the GitHub response.');
  }

  // ── 3. Retrieve related Spine context for each hunk in parallel ───────────
  const retrievedContexts = await Promise.all(
    hunks.map(async (hunk) => {
      // Build a focused query: filename + key symbols from the diff context
      const query = `${hunk.file} ${hunk.context.slice(0, 200)}`;
      const candidates = await rankMemories(userId, query, {
        poolLimit: CONTEXT_PER_HUNK * 4,
        limit: CONTEXT_PER_HUNK,
      }).catch(() => []);

      return {
        hunkFile: hunk.file,
        memories: candidates.map((c) => ({ content: c.content, source: c.source })),
      };
    })
  );

  // ── 4. Synthesise explanation ──────────────────────────────────────────────
  const prompt = buildExplainPrompt(hunks, retrievedContexts);
  const rawJson = await callExplain(prompt);

  type ParsedExplanation = {
    summary?: string;
    hunk_explanations?: HunkExplanation[];
    related_context?: RelatedContext[];
    overall_risk?: 'low' | 'medium' | 'high';
    reviewer_checklist?: string[];
  };

  let parsed2: ParsedExplanation = {};
  try {
    parsed2 = JSON.parse(stripFences(rawJson)) as ParsedExplanation;
  } catch {
    parsed2 = { summary: rawJson.slice(0, 500) };
  }

  return {
    summary: parsed2.summary ?? 'No summary generated.',
    hunk_explanations: Array.isArray(parsed2.hunk_explanations) ? parsed2.hunk_explanations : [],
    related_context: Array.isArray(parsed2.related_context) ? parsed2.related_context : [],
    overall_risk: parsed2.overall_risk ?? 'medium',
    reviewer_checklist: Array.isArray(parsed2.reviewer_checklist) ? parsed2.reviewer_checklist : [],
    diff_url: diffUrl,
    files_changed: hunks.length,
    latencyMs: Date.now() - started,
  };
}
