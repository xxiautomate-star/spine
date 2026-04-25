// Browser-action badge for hygiene signals.
//
// Two-part split so the derivation stays testable without pulling
// chrome.action into a unit test. deriveBadge() is pure; applyBadge()
// is the chrome.action side.
//
// Copy choice: a single bullet '•' instead of a number. MV3 caps badge
// text at 4 chars but the dashboard nudge is meant to be quiet — a
// count would read as an error indicator, not an invitation to tend
// the archive. The amber tint ties the signal to the 'memory glow'
// accent from the design spec (#E89A3C).

import type { HygieneSummary } from './hygiene-storage';

export type BadgeState = {
  text: string;
  color: string;
};

export const BADGE_AMBER = '#E89A3C';
export const BADGE_EMPTY: BadgeState = { text: '', color: BADGE_AMBER };
export const BADGE_DOT: BadgeState = { text: '•', color: BADGE_AMBER };

export function deriveBadge(summary: HygieneSummary | null): BadgeState {
  if (!summary) return BADGE_EMPTY;
  const signal = (summary.duplicatesPending ?? 0) + (summary.staleCount ?? 0);
  return signal > 0 ? BADGE_DOT : BADGE_EMPTY;
}

// chrome.action subset we actually call. Tests inject a fake; real
// callers pass chrome.action which satisfies the shape structurally.
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
