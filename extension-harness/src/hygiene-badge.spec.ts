import { describe, it, expect, vi } from 'vitest';
import {
  deriveBadge,
  applyBadge,
  BADGE_AMBER,
  BADGE_DOT,
  BADGE_EMPTY,
} from './hygiene-badge';
import type { HygieneSummary } from './hygiene-storage';

const enabled = process.env.SPINE_EXT_HARNESS === '1';

const zeroSummary: HygieneSummary = {
  plan: 'free',
  duplicatesPending: 0,
  staleCount: 0,
  clusterCount: 0,
  largestCluster: null,
};

describe.skipIf(!enabled)('deriveBadge', () => {
  it('returns empty badge when summary is null', () => {
    expect(deriveBadge(null)).toEqual(BADGE_EMPTY);
  });

  it('returns empty badge when duplicates + stale are both zero', () => {
    expect(deriveBadge(zeroSummary)).toEqual(BADGE_EMPTY);
  });

  it('returns dot when duplicates > 0', () => {
    const b = deriveBadge({ ...zeroSummary, duplicatesPending: 3 });
    expect(b.text).toBe('\u2022');
    expect(b.color).toBe(BADGE_AMBER);
  });

  it('returns dot when stale > 0', () => {
    expect(deriveBadge({ ...zeroSummary, staleCount: 7 })).toEqual(BADGE_DOT);
  });

  it('returns dot when both counts > 0', () => {
    expect(
      deriveBadge({ ...zeroSummary, duplicatesPending: 2, staleCount: 5 })
    ).toEqual(BADGE_DOT);
  });

  it('treats missing counts as zero and returns empty badge', () => {
    const malformed = { plan: 'free' } as unknown as HygieneSummary;
    expect(deriveBadge(malformed)).toEqual(BADGE_EMPTY);
  });
});

describe.skipIf(!enabled)('applyBadge', () => {
  function makeAction() {
    return {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('writes amber color and dot text for a signal badge', async () => {
    const action = makeAction();
    await applyBadge(BADGE_DOT, action);
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE_AMBER });
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '\u2022' });
  });

  it('clears the badge by writing empty text', async () => {
    const action = makeAction();
    await applyBadge(BADGE_EMPTY, action);
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});
