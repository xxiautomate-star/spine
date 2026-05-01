// Token audit — Gate B of the launch stress-test brief.
//
// Simulates 100 sessions of varying length and measures:
//   - Tokens injected at session-start (recall_recent block)
//   - Tokens added per recall call
//   - Vendor token cost per recall   (Haiku rerank input + output)
//   - Vendor token cost per capture  (embedding API)
//
// Writes a markdown report to docs/TOKEN_AUDIT.md. Run with:
//   npx tsx saas/spine/scripts/token-audit.ts
//
// Pure simulation — no live API calls, no Supabase round-trips. The
// vendor prices are pinned at the top so re-running with new prices is
// a one-line change. The result is the per-user COGS feeding
// docs/UNIT_ECONOMICS.md.
//
// Why simulate rather than measure live: the goal is a *bound*. If
// 100 simulated sessions stay under our gross-margin floor, real
// traffic that follows the same statistical distribution will too.
// Live measurement is for /api/recall logs once we have real users —
// that's a separate dashboard, not this audit.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// .ts extension is intentional — script runs via `node --experimental-strip-types`
// and bare paths fail to resolve under the loader. tsc is told to permit
// .ts-extension imports for this single file via the // @ts-nocheck below.
// (Adding allowImportingTsExtensions globally pulls in the .ts→.js downstream
// rewrite, which we don't want for the rest of the codebase.)
// @ts-expect-error — extension on purpose; see comment above
import { applyInjectionBudget, INJECT_DEFAULTS } from '../lib/retrieval/inject.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'docs', 'TOKEN_AUDIT.md');

// ── Pricing (USD per 1M tokens, sourced 2026-04-30) ────────────────────
const PRICING = {
  haikuInputPerM: 1.0,    // Anthropic Claude Haiku 4.5 input
  haikuOutputPerM: 5.0,   // Anthropic Claude Haiku 4.5 output
  embedPerM: 0.02,        // OpenAI text-embedding-3-small input
};

// ── Session model — derived from earlier dogfood diary observations ────
// We treat a "session" as one Claude Code conversation. Real distribution
// is roughly: 20% tiny (<10 messages), 60% medium (10-40 messages), 20%
// long (40+). We sample from each bucket proportionally.
const SESSIONS_TO_SIMULATE = 100;

const SESSION_PROFILES: Array<{
  weight: number;
  recallsRange: [number, number];
  capturesRange: [number, number];
  recallContextChars: [number, number]; // chars in recall result block
  captureChars: [number, number];       // chars per captured memory
}> = [
  { weight: 0.20, recallsRange: [1, 5], capturesRange: [2, 8], recallContextChars: [800, 2200], captureChars: [80, 240] },
  { weight: 0.60, recallsRange: [4, 18], capturesRange: [8, 25], recallContextChars: [1100, 3000], captureChars: [120, 360] },
  { weight: 0.20, recallsRange: [15, 40], capturesRange: [25, 80], recallContextChars: [1500, 4000], captureChars: [150, 500] },
];

// Mulberry32 PRNG so the audit is reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickProfile(r: () => number) {
  const x = r();
  let acc = 0;
  for (const p of SESSION_PROFILES) {
    acc += p.weight;
    if (x < acc) return p;
  }
  return SESSION_PROFILES[SESSION_PROFILES.length - 1];
}

function rangeInt(r: () => number, [a, b]: [number, number]): number {
  return Math.floor(a + r() * (b - a + 1));
}

function tokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function tokensFor(text: string): number {
  return tokens(text.length);
}

function simulate() {
  const r = rng(0x5e1e); // deterministic seed (just a memorable hex)
  const result = {
    sessions: 0,
    totalRecalls: 0,
    totalCaptures: 0,
    tokensInjectedAtSessionStart: 0,
    tokensInjectedAtRecallCalls: 0,
    embedTokens: 0,
    haikuInputTokens: 0,
    haikuOutputTokens: 0,
    droppedBelowFloor: 0,
    droppedDeduped: 0,
    droppedOverBudget: 0,
  };

  for (let i = 0; i < SESSIONS_TO_SIMULATE; i++) {
    const profile = pickProfile(r);
    const recalls = rangeInt(r, profile.recallsRange);
    const captures = rangeInt(r, profile.capturesRange);

    result.sessions += 1;
    result.totalRecalls += recalls;
    result.totalCaptures += captures;

    // Session-start: one recall_recent block at boot. Cost ≈ chars / 4.
    const startChars = rangeInt(r, profile.recallContextChars);
    result.tokensInjectedAtSessionStart += tokens(startChars);

    // Per-recall: model pulls a candidate pool then runs Haiku rerank.
    // Pool size is bounded by the retriever (poolLimit=20, see
    // lib/retrieval.ts). The injected block applies budget rules below.
    for (let n = 0; n < recalls; n++) {
      // Synthetic candidate set — 8-15 memories, scores Beta-ish near 0.5.
      const candidateCount = 8 + Math.floor(r() * 8);
      const candidates = Array.from({ length: candidateCount }, (_, j) => ({
        id: `sim-${i}-${n}-${j}`,
        content: 'x'.repeat(rangeInt(r, profile.captureChars)),
        source: null,
        createdAt: new Date().toISOString(),
        score: Math.max(0, Math.min(1.2, 0.55 + (r() - 0.5) * 0.6)), // jittered around 0.55
      }));

      // Apply Gate-B budget — drops below-floor + dedupe + budget cap.
      const budgeted = applyInjectionBudget(candidates, {
        tokenBudget: INJECT_DEFAULTS.budgetTokens,
        injectFloor: INJECT_DEFAULTS.floor,
      });
      result.droppedBelowFloor += budgeted.dropped.belowFloor;
      result.droppedDeduped += budgeted.dropped.deduped;
      result.droppedOverBudget += budgeted.dropped.overBudget;
      result.tokensInjectedAtRecallCalls += budgeted.estimatedTokens;

      // Vendor cost — Haiku rerank: candidate pool as input, single
      // structured pick list as output.
      let haikuInput = 200; // system prompt baseline
      for (const c of candidates) {
        const t = tokensFor(c.content);
        if (Number.isFinite(t)) haikuInput += t;
      }
      const haikuOutput = 60; // 5-10 picks × ~10 tokens each (id + score)
      result.haikuInputTokens += haikuInput;
      result.haikuOutputTokens += haikuOutput;
    }

    // Per-capture: embedding the memory text.
    for (let c = 0; c < captures; c++) {
      const chars = rangeInt(r, profile.captureChars);
      result.embedTokens += tokens(chars);
    }
  }

  return result;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$ERR';
  // Cents-level resolution if the cost is large enough to round, otherwise
  // 4 decimals so per-session sub-cent figures stay readable.
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function fmtRate(usdPerM: number): string {
  // Prices are quoted per 1M tokens. We always render that way so the
  // table's units match the source pricing pages.
  return `$${usdPerM.toFixed(2)}`;
}

function main() {
  const r = simulate();

  const haikuInputCost = (r.haikuInputTokens / 1_000_000) * PRICING.haikuInputPerM;
  const haikuOutputCost = (r.haikuOutputTokens / 1_000_000) * PRICING.haikuOutputPerM;
  const embedCost = (r.embedTokens / 1_000_000) * PRICING.embedPerM;
  const totalCost = haikuInputCost + haikuOutputCost + embedCost;
  const costPerSession = totalCost / r.sessions;

  const tokensPerRecallAvg = r.tokensInjectedAtRecallCalls / r.totalRecalls;
  const tokensPerSessionAvg = (r.tokensInjectedAtSessionStart + r.tokensInjectedAtRecallCalls) / r.sessions;

  const md = `# Token audit

Auto-generated by \`scripts/token-audit.ts\`. Re-run after changing
\`lib/retrieval/inject.ts\` budget defaults, vendor pricing, or the
session profiles in this script. **Do not hand-edit** — the file gets
overwritten.

Last run: ${new Date().toISOString()}

## Inputs

- Sessions simulated: **${r.sessions}**
- Session-profile mix: 20% small / 60% medium / 20% long (calibrated from
  early dogfood observations)
- PRNG: deterministic seed — same numbers every run
- Vendor prices (USD per 1M tokens):
  - Haiku 4.5 input  · ${fmtRate(PRICING.haikuInputPerM)} / 1M
  - Haiku 4.5 output · ${fmtRate(PRICING.haikuOutputPerM)} / 1M
  - text-embedding-3-small · ${fmtRate(PRICING.embedPerM)} / 1M

## Volumes

| | Total | Per session avg |
|---|---:|---:|
| Recalls | ${r.totalRecalls.toLocaleString()} | ${(r.totalRecalls / r.sessions).toFixed(1)} |
| Captures | ${r.totalCaptures.toLocaleString()} | ${(r.totalCaptures / r.sessions).toFixed(1)} |

## Tokens injected into LLM context

| Stream | Tokens (total) | Tokens (per session) |
|---|---:|---:|
| Session-start recall_recent block | ${r.tokensInjectedAtSessionStart.toLocaleString()} | ${(r.tokensInjectedAtSessionStart / r.sessions).toFixed(0)} |
| Per-recall injection | ${r.tokensInjectedAtRecallCalls.toLocaleString()} | ${(r.tokensInjectedAtRecallCalls / r.sessions).toFixed(0)} |
| **Total** | **${(r.tokensInjectedAtSessionStart + r.tokensInjectedAtRecallCalls).toLocaleString()}** | **${tokensPerSessionAvg.toFixed(0)}** |

Avg tokens per recall: **${tokensPerRecallAvg.toFixed(0)}** (budget: ${INJECT_DEFAULTS.budgetTokens}, hard cap: ${INJECT_DEFAULTS.hardCap})

## Vendor cost

| Stream | Tokens | Cost (USD) |
|---|---:|---:|
| Haiku rerank input | ${r.haikuInputTokens.toLocaleString()} | ${fmtUsd(haikuInputCost)} |
| Haiku rerank output | ${r.haikuOutputTokens.toLocaleString()} | ${fmtUsd(haikuOutputCost)} |
| OpenAI embeddings | ${r.embedTokens.toLocaleString()} | ${fmtUsd(embedCost)} |
| **Total** | | **${fmtUsd(totalCost)}** |

**Per-session avg cost: ${fmtUsd(costPerSession)}** ⇐ feeds \`docs/UNIT_ECONOMICS.md\`

## Budget enforcement (lib/retrieval/inject.ts effects)

Across all simulated recalls, budget rules dropped:

- Below-floor (score < ${INJECT_DEFAULTS.floor}): ${r.droppedBelowFloor.toLocaleString()} memories
- Session-deduped: ${r.droppedDeduped.toLocaleString()} memories
- Over-budget: ${r.droppedOverBudget.toLocaleString()} memories

If "below-floor" dominates, the retriever is returning too much weak
relevance — tune \`lib/retrieval.ts\` weights down. If "over-budget"
dominates, raise \`SPINE_INJECT_BUDGET\` (capped at ${INJECT_DEFAULTS.hardCap})
or tighten the floor.
`;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, md);
  console.log(`[token-audit] wrote ${OUT_PATH}`);
  console.log(`[token-audit] per-session cost: ${fmtUsd(costPerSession)}`);
}

main();
