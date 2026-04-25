// Content-script entry — injected into chatgpt.com / gemini.google.com.
//
// Thin dispatcher only: on tab focus, ping the background worker so it
// can run the debounced hygiene poll. Service workers can't subscribe
// to page visibility events directly, so we pay one cheap
// chrome.runtime.sendMessage round-trip instead of moving the whole
// poll into the page context (which would also splinter storage and
// badge ownership across tabs).

const MESSAGE_TYPE = 'SPINE_HYGIENE_POLL';

function ping(): void {
  if (document.visibilityState !== 'visible') return;
  // Worker may be asleep between pings; a failed send here is fine
  // because the next visibility flip retries. Swallow the rejection
  // so it doesn't surface in the page console as an extension error.
  void chrome.runtime.sendMessage({ type: MESSAGE_TYPE }).catch(() => {});
}

document.addEventListener('visibilitychange', ping);
// Fire once on injection — tab may already be visible.
ping();

export {};
