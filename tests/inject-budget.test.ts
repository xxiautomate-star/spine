// Gate B unit tests for the adaptive injection budget.

import { describe, expect, it, afterEach } from 'vitest';
import {
  applyInjectionBudget,
  INJECT_DEFAULTS,
  type InjectableMemory,
} from '@/lib/retrieval/inject';

function memo(id: string, content: string, score: number): InjectableMemory {
  return { id, content, source: null, createdAt: '2026-04-30T00:00:00Z', score };
}

describe('applyInjectionBudget', () => {
  const ORIGINAL_ENV = process.env.SPINE_INJECT_BUDGET;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.SPINE_INJECT_BUDGET;
    else process.env.SPINE_INJECT_BUDGET = ORIGINAL_ENV;
  });

  it('drops memories below the relevance floor', () => {
    const out = applyInjectionBudget([
      memo('a', 'high relevance fact about postgres', 0.8),
      memo('b', 'low relevance noise about lunch', 0.2),
      memo('c', 'borderline — exactly at floor', 0.4),
    ]);
    expect(out.dropped.belowFloor).toBe(1);
    expect(out.picked.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('respects a custom floor', () => {
    const out = applyInjectionBudget(
      [memo('a', 'x', 0.5), memo('b', 'y', 0.55), memo('c', 'z', 0.6)],
      { injectFloor: 0.55 }
    );
    expect(out.picked.map((m) => m.id)).toEqual(['b', 'c']);
    expect(out.dropped.belowFloor).toBe(1);
  });

  it('dedupes against an alreadyInjected set', () => {
    const out = applyInjectionBudget(
      [memo('a', 'x', 0.9), memo('b', 'y', 0.9), memo('c', 'z', 0.9)],
      { alreadyInjectedIds: new Set(['b']) }
    );
    expect(out.dropped.deduped).toBe(1);
    expect(out.picked.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('stops adding memories once the token budget is reached', () => {
    // 1000 chars per memory ≈ 250 tokens each + format overhead ≈ 8 ≈ 258
    // Tiny budget = 100 tokens → 0 memories fit.
    const big = memo('a', 'x'.repeat(1000), 0.9);
    const out = applyInjectionBudget([big, big, big], { tokenBudget: 100 });
    expect(out.picked).toHaveLength(0);
    expect(out.dropped.overBudget).toBe(3);
  });

  it('honors SPINE_INJECT_BUDGET env override', () => {
    process.env.SPINE_INJECT_BUDGET = '50';
    const out = applyInjectionBudget([memo('a', 'x'.repeat(1000), 0.9)]);
    expect(out.picked).toHaveLength(0);
    expect(out.tokenBudget).toBe(50);
  });

  it('clamps SPINE_INJECT_BUDGET to the hard cap', () => {
    process.env.SPINE_INJECT_BUDGET = '99999';
    const out = applyInjectionBudget([memo('a', 'x', 0.9)]);
    expect(out.tokenBudget).toBe(INJECT_DEFAULTS.hardCap);
  });

  it('explicit tokenBudget overrides env', () => {
    process.env.SPINE_INJECT_BUDGET = '5000';
    const out = applyInjectionBudget([memo('a', 'x', 0.9)], { tokenBudget: 200 });
    expect(out.tokenBudget).toBe(200);
  });

  it('clamps an explicit budget over the hard cap', () => {
    const out = applyInjectionBudget([memo('a', 'x', 0.9)], {
      tokenBudget: INJECT_DEFAULTS.hardCap * 10,
    });
    expect(out.tokenBudget).toBe(INJECT_DEFAULTS.hardCap);
  });

  it('returns an empty result for empty input', () => {
    const out = applyInjectionBudget([]);
    expect(out.picked).toEqual([]);
    expect(out.estimatedTokens).toBe(0);
    expect(out.dropped).toEqual({ belowFloor: 0, deduped: 0, overBudget: 0 });
  });

  it('preserves retriever order (does not re-rank within budget)', () => {
    const out = applyInjectionBudget([
      memo('first', 'a', 0.9),
      memo('second', 'b', 0.95),
      memo('third', 'c', 0.5),
    ]);
    expect(out.picked.map((m) => m.id)).toEqual(['first', 'second', 'third']);
  });
});
