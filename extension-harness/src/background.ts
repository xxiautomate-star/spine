// Background service worker — owns the hygiene poll, storage, and badge
// for cross-tab consistency.
//
// Flow:
//   content-entry (per tab) --[visibilitychange]--> chrome.runtime.sendMessage
//     --> this worker --> createHygienePoller.poll()
//                         --> chrome.storage.local (via storage adapter)
//                         --> applyBadge(deriveBadge(summary))
//
// Why the worker instead of per-tab content scripts doing it directly:
// one badge writer means no races between tabs racing to paint the
// icon. chrome.storage.onChanged defensively re-applies if anything
// else writes to the record (e.g. the options page clearing state).
//
// Settings (apiBase, apiKey) live under their own storage key so the
// options page can write them without coupling to the hygiene state
// record.

import { createHygienePoller } from './content';
import { createChromeHygieneStore, type HygieneState } from './hygiene-storage';
import { applyBadge, deriveBadge } from './hygiene-badge';

const MESSAGE_TYPE = 'SPINE_HYGIENE_POLL';
const HYGIENE_STATE_KEY = 'spine:hygiene';
const SETTINGS_KEY = 'spine:settings';
const DEFAULT_API_BASE = 'https://spine.xxiautomate.com';

type Settings = { apiBase: string; apiKey: string | null };

async function readSettings(): Promise<Settings> {
  const bag = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = bag[SETTINGS_KEY];
  if (raw && typeof raw === 'object') {
    const s = raw as Partial<Settings>;
    return {
      apiBase: typeof s.apiBase === 'string' ? s.apiBase : DEFAULT_API_BASE,
      apiKey: typeof s.apiKey === 'string' ? s.apiKey : null,
    };
  }
  return { apiBase: DEFAULT_API_BASE, apiKey: null };
}

const storage = createChromeHygieneStore();

// Lazy poller — built on first message so settings reads don't run on
// every service-worker wake. If settings change mid-session we blow
// the cache from the onChanged listener below.
let poller: ReturnType<typeof createHygienePoller> | null = null;

async function getPoller() {
  if (poller) return poller;
  const settings = await readSettings();
  poller = createHygienePoller({
    apiBase: settings.apiBase,
    apiKey: settings.apiKey,
    storage,
    onSummary: (summary) => {
      void applyBadge(deriveBadge(summary));
    },
  });
  return poller;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || (msg as { type?: unknown }).type !== MESSAGE_TYPE) return false;
  (async () => {
    try {
      const p = await getPoller();
      const outcome = await p.poll();
      // Newly opened tabs need the badge painted even when the poll
      // short-circuits (debounced / 304). Re-apply from persisted state
      // so every visible tab ping converges on the correct dot.
      if (outcome !== 'fetched') {
        const state = await storage.get();
        await applyBadge(deriveBadge(state.summary));
      }
      sendResponse({ outcome });
    } catch (err) {
      sendResponse({ outcome: 'error', error: String(err) });
    }
  })();
  return true; // keep sendResponse valid across the await
});

// Service workers cold-start all the time in MV3 — repaint on boot.
(async () => {
  const state = await storage.get();
  await applyBadge(deriveBadge(state.summary));
})();

// If storage is written by anyone (options page clearing state, a
// second worker instance during rehydration), reflect on the badge.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const stateChange = changes[HYGIENE_STATE_KEY];
  if (stateChange) {
    const next = stateChange.newValue as Partial<HygieneState> | undefined;
    void applyBadge(deriveBadge(next?.summary ?? null));
  }
  if (changes[SETTINGS_KEY]) {
    // Settings changed — next poll should pick up the new apiKey/apiBase.
    poller = null;
  }
});

export {};
