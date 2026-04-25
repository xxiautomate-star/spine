// Cross-repo reasoner: searches ALL indexed repos simultaneously, then runs a
// synthesis step to surface cross-repo patterns, conflicts, and primary answers.
//
// Design: each repo gets its own parallel hybrid search (BM25 + cosine), capped
// at TOP_PER_REPO results. The union is sent to Haiku-4.5 for synthesis with a
// prompt engineered to reason across source boundaries. Graph expansion is NOT
// run here — we want clean per-repo signal before cross-wiring.

import { embedText } from './openai';
import { getSupabase } from './supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL = 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const TOP_PER_REPO = 5;    // candidates to surface per repo before synthesis
const MAX_REPOS = 12;      // safety cap — synthesis prompt stays under 8k tokens
const RRF_K = 60;
const DECAY_HALF_LIFE = 90; // days

// ── Synthesis prompt ──────────────────────────────────────────────────────────
//
// This is the core reasoning surface. The model sees labelled per-repo excerpts
// and must answer the query while explicitly reasoning across source boundaries.
// Cache_control marks it ephemeral so successive calls in a session hit the
// Anthropic prompt cache (~$0.10/MTok read vs $1.00/MTok uncached).

const SYNTHESIS_SYSTEM = `You are Spine's cross-repo reasoning engine.

You receive a user query and memory excerpts retrieved simultaneously from MULTIPLE source repositories. Each excerpt is labelled with its repo and source file.

Your job is to produce a synthesis that:
1. Directly answers the query, citing specific repos and files where the evidence lives.
2. Identifies which single repo contains the most relevant context for this query.
3. Surfaces patterns that appear ACROSS repos — shared libraries, repeated logic, common conventions.
4. Identifies conflicts or inconsistencies — places where repo A handles something differently from repo B.
5. Flags gaps — if no repo has relevant context for part of the query, say so explicitly.

CITATION RULES:
- Always cite with [repo/source] when quoting or paraphrasing.
- If the same pattern appears in ≥2 repos, list all of them.
- Prefer quoting actual content over paraphrasing when space allows.

Output STRICT JSON — nothing before or after the object:
{
  "answer": "<direct 2-5 sentence answer to the query with inline [repo/source] citations>",
  "primary_repo": "<name of the single most relevant repo, or null if tied>",
  "citations": [
    {
      "repo": "<repo name>",
      "source": "<file path or source label>",
      "excerpt": "<verbatim snippet under 120 chars>",
      "relevance": "<one sentence on why this is relevant>"
    }
  ],
  "cross_repo_patterns": [
    "<concrete pattern found in ≥2 repos — include repo names>"
  ],
  "conflicts": [
    {
      "repo_a": "<repo name>",
      "repo_b": "<repo name>",
      "description": "<what differs and why it matters>"
    }
  ],
  "gaps": "<what the query asked for that no repo had context on, or null>"
}`;

// ── Types ─────────────────────────────────────────────────────────────────────

export type RepoCandidate = {
  id: string;
  repo: string;
  source: string | null;
  content: string;
  createdAt: string;
  vecSimilarity: number;
  bm25Rank: number;
  fusedScore: number;
};

export type CrossRepoCitation = {
  repo: string;
  source: string;
  excerpt: string;
  relevance: string;
};

export type CrossRepoResult = {
  answer: string;
  primary_repo: string | null;
  citations: CrossRepoCitation[];
  cross_repo_patterns: string[];
  conflicts: Array<{ repo_a: string; repo_b: string; description: string }>;
  gaps: string | null;
  repos_searched: string[];
  candidates_per_repo: Record<string, number>;
  latencyMs: number;
  synthesisLatencyMs: number;
};

type RawRow = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  type: string;
  project: string | null;
  created_at: string;
  vec_similarity: number;
  bm25_rank: number;
};

// ── Per-repo hybrid search ────────────────────────────────────────────────────

async function searchRepo(
  userId: string,
  repo: string,
  query: string,
  embedding: number[],
  poolLimit: number
): Promise<RepoCandidate[]> {
  const supabase = getSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('spine_repo_hybrid_candidates', {
    p_user: userId,
    p_query: query,
    p_query_embedding: embedding,
    p_project: repo,
    p_limit: poolLimit,
  });

  if (error || !data) return [];

  const rows = data as RawRow[];
  if (rows.length === 0) return [];

  // RRF fusion
  const vecOrder = [...rows]
    .filter((r) => r.vec_similarity > 0)
    .sort((a, b) => b.vec_similarity - a.vec_similarity);
  const bm25Order = [...rows]
    .filter((r) => r.bm25_rank > 0)
    .sort((a, b) => b.bm25_rank - a.bm25_rank);

  const vecPos = new Map<string, number>();
  vecOrder.forEach((r, i) => vecPos.set(r.id, i + 1));
  const bm25Pos = new Map<string, number>();
  bm25Order.forEach((r, i) => bm25Pos.set(r.id, i + 1));

  const now = Date.now();
  const decayTau = DECAY_HALF_LIFE / Math.LN2;

  return rows
    .map((r) => {
      const vp = vecPos.get(r.id) ?? 0;
      const bp = bm25Pos.get(r.id) ?? 0;
      const rrf = (vp > 0 ? 1 / (RRF_K + vp) : 0) + (bp > 0 ? 1 / (RRF_K + bp) : 0);
      const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
      const decay = Math.exp(-ageDays / decayTau);
      return {
        id: r.id,
        repo,
        source: r.source,
        content: r.content,
        createdAt: r.created_at,
        vecSimilarity: r.vec_similarity,
        bm25Rank: r.bm25_rank,
        fusedScore: rrf * decay,
      };
    })
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, TOP_PER_REPO);
}

// ── Synthesis call ────────────────────────────────────────────────────────────

function buildSynthesisPrompt(
  query: string,
  byRepo: Map<string, RepoCandidate[]>
): string {
  const sections: string[] = [`Query: ${query}\n`];

  for (const [repo, candidates] of byRepo) {
    if (candidates.length === 0) continue;
    sections.push(`=== Repo: ${repo} ===`);
    for (const c of candidates) {
      const src = c.source ? ` [${c.source}]` : '';
      // Truncate content to ~600 chars so the prompt stays manageable
      const body = c.content.length > 600 ? c.content.slice(0, 600) + '…' : c.content;
      sections.push(`${src}\n${body}`);
    }
  }

  sections.push('\nReturn JSON synthesis:');
  return sections.join('\n\n');
}

async function callSynthesis(prompt: string): Promise<string> {
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
      system: [{ type: 'text', text: SYNTHESIS_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Haiku synthesis ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content.find((b) => b.type === 'text')?.text ?? '{}';
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search all indexed repos simultaneously and synthesise a cross-repo answer.
 *
 * @param userId  Spine user ID (from auth)
 * @param query   Natural language question
 * @param repos   Explicit repo list. If empty, discovered from distinct `project` values.
 */
export async function crossRepoReason(
  userId: string,
  query: string,
  repos?: string[]
): Promise<CrossRepoResult> {
  const started = Date.now();
  const supabase = getSupabase();
  if (!supabase) throw new Error('Spine not configured — missing Supabase credentials.');

  // ── 1. Discover repos if not provided ──────────────────────────────────────
  let targetRepos: string[] = repos ?? [];

  if (targetRepos.length === 0) {
    const { data: projects } = await supabase
      .from('memories')
      .select('project')
      .eq('user_id', userId)
      .not('project', 'is', null)
      .is('deleted_at', null)
      .limit(200);

    const seen = new Set<string>();
    for (const row of projects ?? []) {
      if (row.project && typeof row.project === 'string') seen.add(row.project);
    }
    targetRepos = [...seen].slice(0, MAX_REPOS);
  }

  if (targetRepos.length === 0) {
    return {
      answer: 'No indexed repositories found. Capture some sessions first.',
      primary_repo: null,
      citations: [],
      cross_repo_patterns: [],
      conflicts: [],
      gaps: 'No repos indexed.',
      repos_searched: [],
      candidates_per_repo: {},
      latencyMs: Date.now() - started,
      synthesisLatencyMs: 0,
    };
  }

  // ── 2. Embed query once, reuse across all repo searches ───────────────────
  const embedding = await embedText(query);

  // ── 3. Parallel per-repo hybrid search ───────────────────────────────────
  const searchResults = await Promise.all(
    targetRepos.map((repo) =>
      searchRepo(userId, repo, query, embedding, TOP_PER_REPO * 2).catch(() => [] as RepoCandidate[])
    )
  );

  const byRepo = new Map<string, RepoCandidate[]>();
  const candidatesPerRepo: Record<string, number> = {};

  for (let i = 0; i < targetRepos.length; i++) {
    const repo = targetRepos[i];
    const candidates = searchResults[i];
    byRepo.set(repo, candidates);
    candidatesPerRepo[repo] = candidates.length;
  }

  // Repos with zero results are still noted but excluded from the synthesis prompt
  const reposWithContent = [...byRepo.entries()].filter(([, c]) => c.length > 0);

  // ── 4. Synthesis ──────────────────────────────────────────────────────────
  const synthStart = Date.now();
  let synthesised: CrossRepoResult;

  if (reposWithContent.length === 0) {
    synthesised = {
      answer: 'No relevant context found in any indexed repository for this query.',
      primary_repo: null,
      citations: [],
      cross_repo_patterns: [],
      conflicts: [],
      gaps: query,
      repos_searched: targetRepos,
      candidates_per_repo: candidatesPerRepo,
      latencyMs: 0,
      synthesisLatencyMs: 0,
    };
  } else {
    const repoMap = new Map<string, RepoCandidate[]>(reposWithContent);
    const prompt = buildSynthesisPrompt(query, repoMap);
    const rawJson = await callSynthesis(prompt);

    type ParsedSynthesis = {
      answer?: string;
      primary_repo?: string | null;
      citations?: CrossRepoCitation[];
      cross_repo_patterns?: string[];
      conflicts?: Array<{ repo_a: string; repo_b: string; description: string }>;
      gaps?: string | null;
    };

    let parsed: ParsedSynthesis = {};
    try {
      parsed = JSON.parse(stripFences(rawJson)) as ParsedSynthesis;
    } catch {
      // Fallback: treat raw text as answer
      parsed = { answer: rawJson.slice(0, 500) };
    }

    synthesised = {
      answer: parsed.answer ?? 'No answer generated.',
      primary_repo: parsed.primary_repo ?? null,
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      cross_repo_patterns: Array.isArray(parsed.cross_repo_patterns) ? parsed.cross_repo_patterns : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      gaps: parsed.gaps ?? null,
      repos_searched: targetRepos,
      candidates_per_repo: candidatesPerRepo,
      latencyMs: 0,
      synthesisLatencyMs: 0,
    };
  }

  synthesised.latencyMs = Date.now() - started;
  synthesised.synthesisLatencyMs = Date.now() - synthStart;
  return synthesised;
}
