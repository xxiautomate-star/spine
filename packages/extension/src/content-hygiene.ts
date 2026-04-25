// Hygiene content script — injected into AI host pages.
// Promoted from extension-harness/src/content-entry.ts.
//
// Thin dispatcher only: pings the background service worker on tab
// focus so the worker can run the debounced hygiene poll. The flag
// check (hygienePoll setting) lives in the worker — a single source of
// truth regardless of how many tabs are open.

void chrome.runtime.sendMessage({ type: 'spine.hygiene.poll' }).catch(() => {});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  void chrome.runtime.sendMessage({ type: 'spine.hygiene.poll' }).catch(() => {});
});
