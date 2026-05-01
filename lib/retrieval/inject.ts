// Adaptive injection budget. Gate B of the launch stress-test brief.
//
// Purpose: keep token spend per recall predictable. The previous block
// builder accepted whatever the retriever returned and trimmed by char
// budget — meaning a wide recall could push hundreds of low-relevance
// memories into the LLM's context, burning input tokens.
//
// This module enforces three rules ON TOP OF lib/context-block.ts:
//
//   1. **Token budget.** Default 1500. User-overridable via
//      SPINE_INJECT_BUDGET env var. Hard cap 4000 — any value above
//      that is clamped down so a misconfigured env can never explode
//      our COGS.
//
//   2. **Lazy injection.** Memories with relevance score < INJECT_FLOOR
//      (default 0.4) are dropped before the budget is computed. Cheap
//      ranks the retriever returned but the LLM would barely use are
//      not worth the token spend.
//
//   3. **Session dedupe.** If a memory was already injected in the same
//      session (tracked by session_id via the existing logInjections
//      helper), drop it. Re-injecting yesterday's same fact every turn
//      wastes tokens and dilutes signal.
//
// Returns the FILTERED memory list ready for buildInjectionBlock. The
// caller still owns block formatting + delivery.

import type { BlockMemory } from '../context-block';

const DEFAULT_BUDGET_TOKENS = 1500;
const HARD_CAP_TOKENS = 4000;
const INJECT_FLOOR = 0.4; // relevance score below which a memory is dropped pre-budget

export type InjectableMemory = BlockMemory & {
  /** Composite relevance score from rankMemories. Range roughly [0, 1+]. */
  score: number;
};

export type ApplyBudgetOptions = {
  /** Override the default 1500-token budget. Clamped to HARD_CAP_TOKENS. */
  tokenBudget?: number;
  /** Minimum relevance score for inclusion. Defaults to INJECT_FLOOR. */
  injectFloor?: number;
  /** Memory IDs already injected this session — skipped for dedupe. */
  alreadyInjectedIds?: ReadonlySet<string>;
};

export type AppliedBudget = {
  picked: BlockMemory[];
  dropped: {
    belowFloor: number;
    deduped: number;
    overBudget: number;
  };
  tokenBudget: number;
  estimatedTokens: number;
};

function resolveBudget(override: number | undefined): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.min(override, HARD_CAP_TOKENS);
  }
  const envRaw = process.env.SPINE_INJECT_BUDGET;
  if (envRaw) {
    const parsed = parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, HARD_CAP_TOKENS);
    }
  }
  return DEFAULT_BUDGET_TOKENS;
}

function estimateTokens(text: string): number {
  // ~4 chars per token is the working approximation across cl100k_base
  // and o200k_base tokenizers. Errs slightly on the high side, which is
  // safe for budget enforcement.
  return Math.ceil(text.length / 4);
}

/**
 * Apply the three Gate-B rules and return the trimmed memory list.
 * Pure — no DB, no network, no env reads beyond resolveBudget.
 */
export function applyInjectionBudget(
  memories: readonly InjectableMemory[],
  opts: ApplyBudgetOptions = {}
): AppliedBudget {
  const tokenBudget = resolveBudget(opts.tokenBudget);
  const floor = opts.injectFloor ?? INJECT_FLOOR;
  const alreadyInjected = opts.alreadyInjectedIds ?? new Set<string>();

  const dropped = { belowFloor: 0, deduped: 0, overBudget: 0 };

  // Rule 1+2: floor + dedupe. Apply BEFORE budget so the cheapest cut
  // happens first and we're not deciding "fit budget?" on memories the
  // LLM wouldn't have used.
  const candidates: InjectableMemory[] = [];
  for (const m of memories) {
    if (m.score < floor) {
      dropped.belowFloor += 1;
      continue;
    }
    if (alreadyInjected.has(m.id)) {
      dropped.deduped += 1;
      continue;
    }
    candidates.push(m);
  }

  // Rule 3: token budget. Iterate in incoming order (already ranked by
  // the retriever) and stop when adding the next memory would exceed.
  // Estimate via char/4. We over-estimate by ~20-40 chars for the
  // formatting overhead each line incurs in buildInjectionBlock —
  // acceptable buffer.
  const FORMAT_OVERHEAD_PER_LINE = 32;
  const picked: InjectableMemory[] = [];
  let usedTokens = 0;
  for (const m of candidates) {
    const lineTokens = estimateTokens(m.content) + Math.ceil(FORMAT_OVERHEAD_PER_LINE / 4);
    if (usedTokens + lineTokens > tokenBudget) {
      dropped.overBudget = candidates.length - picked.length;
      break;
    }
    picked.push(m);
    usedTokens += lineTokens;
  }

  return {
    picked,
    dropped,
    tokenBudget,
    estimatedTokens: usedTokens,
  };
}

export const INJECT_DEFAULTS = {
  budgetTokens: DEFAULT_BUDGET_TOKENS,
  hardCap: HARD_CAP_TOKENS,
  floor: INJECT_FLOOR,
};
