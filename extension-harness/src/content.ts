// Spine hygiene content script — Phase 9 staging.
//
// Listens for document.visibilitychange and, when a tab becomes visible,
// polls /api/hygiene/summary. The extension's service worker is the
// source of truth for cross-tab consistency (see step 4); this content
// script only fires a debounced trigger so background work isn't tied
// to a persistent page context.
//
// Debounce is 30s per document. Background may have already refreshed
// in that window from a different tab — the server's ETag + 304 path
// makes the extra hits cheap anyway, but debouncing keeps the message
// channel quiet.
//
// This file stays under /extension-harness/ and the SPINE_EXT_HARNESS
// flag until Phase 9 greenlights promotion into packages/extension/.

const POLL_DEBOUNCE_MS = 30_000;
const ENDPOINT_PATH = '/api/hygiene/summary';

type HygieneSummary = {
  plan: string;
  duplicatesPending: number;
  staleCount: number;
  clusterCount: number;
  largestCluster: { label: string; size: number } | null;
};

type PollOutcome = 'fetched' | 'not-modified' | 'debounced' | 'no-key' | 'error';

type PollerConfig = {
  apiBase: string;
  apiKey: string | null;
  debounceMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  onSummary?: (summary: HygieneSummary) => void;
  onError?: (err: unknown) => void;
};

// In-memory ETag holder. Step 2 replaces this with chrome.storage.local
// so the value survives content-script reloads and is readable from the
// background worker.
type MemoryETagStore = {
  etag: string | null;
  summary: HygieneSummary | null;
};

export function createHygienePoller(config: PollerConfig) {
  const debounceMs = config.debounceMs ?? POLL_DEBOUNCE_MS;
  const now = config.now ?? (() => Date.now());
  const fetchImpl = config.fetchImpl ?? fetch;

  const store: MemoryETagStore = { etag: null, summary: null };
  let lastFetchedAt = 0;
  let inFlight: Promise<PollOutcome> | null = null;

  async function poll(): Promise<PollOutcome> {
    if (!config.apiKey) return 'no-key';
    const t = now();
    if (t - lastFetchedAt < debounceMs) return 'debounced';
    if (inFlight) return inFlight;

    lastFetchedAt = t;
    inFlight = (async (): Promise<PollOutcome> => {
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
        };
        if (store.etag) headers['If-None-Match'] = store.etag;

        const res = await fetchImpl(`${config.apiBase}${ENDPOINT_PATH}`, {
          method: 'GET',
          headers,
          credentials: 'omit',
        });

        if (res.status === 304) return 'not-modified';
        if (!res.ok) {
          config.onError?.(new Error(`hygiene summary ${res.status}`));
          return 'error';
        }

        const etag = res.headers.get('ETag');
        const summary = (await res.json()) as HygieneSummary;
        if (etag) store.etag = etag;
        store.summary = summary;
        config.onSummary?.(summary);
        return 'fetched';
      } catch (err) {
        config.onError?.(err);
        return 'error';
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function attachVisibilityListener(doc: Document = document): () => void {
    const handler = () => {
      if (doc.visibilityState === 'visible') {
        void poll();
      }
    };
    doc.addEventListener('visibilitychange', handler);
    return () => doc.removeEventListener('visibilitychange', handler);
  }

  return { poll, attachVisibilityListener };
}
