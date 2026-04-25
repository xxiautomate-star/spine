// Browser-action badge for hygiene signals.
// Promoted from extension-harness/src/hygiene-badge.ts.

import type { HygieneSummary } from './hygiene-storage';

export type BadgeState = { text: string; color: string };

export const BADGE_AMBER = '#E89A3C';
export const BADGE_EMPTY: BadgeState = { text: '', color: BADGE_AMBER };
export const BADGE_DOT: BadgeState = { text: '\u2022', color: BADGE_AMBER };

export function deriveBadge(summary: HygieneSummary | null): BadgeState {
  if (!summary) return BADGE_EMPTY;
  const signal = (summary.duplicatesPending ?? 0) + (summary.staleCount ?? 0);
  return signal > 0 ? BADGE_DOT : BADGE_EMPTY;
}

type ChromeActionLike = {
  setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
};

export async function applyBadge(
  badge: BadgeState,
  action: ChromeActionLike = chrome.action
): Promise<void> {
  await action.setBadgeBackgroundColor({ color: badge.color });
  await action.setBadgeText({ text: badge.text });
}
