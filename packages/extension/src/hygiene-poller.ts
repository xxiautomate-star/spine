// Hygiene poll factory — promoted from extension-harness/src/content.ts.
// createHygienePoller() returns a { poll, attachVisibilityListener } pair.
// The background service worker instantiates one per extension lifetime
// and calls poll() on every 'spine.hygiene.poll' message.

import type { HygieneState, HygieneSummary, StorageAdapter } from './hygiene-storage';
import { EMPTY_STATE } from './hygiene-storage';

const POLL_DEBOUNCE_MS = 30_000;
const ENDPOINT_PATH = '/api/hygiene/summary';

export type PollOutcome =
  | 'fetched'
  | 'not-modified'
  | 'debounced'
  | 'no-key'
  | 'error';

export type PollerConfig = {
  apiBase: string;
  apiKey: string | null;
  storage: StorageAdapter;
  debounceMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
  onSummary?: (summary: HygieneSummary) => void;
  onError?: (err: unknown) => void;
};

export function createHygienePoller(config: PollerConfig) {
  const debounceMs = config.debounceMs ?? POLL_DEBOUNCE_MS;
  const now = config.now ?? (() => Date.now());
  const fetchImpl = config.fetchImpl ?? fetch;

  let inFlight: Promise<PollOutcome> | null = null;

  function poll(): Promise<PollOutcome> {
    if (!config.apiKey) return Promise.resolve('no-key');
    if (inFlight) return inFlight;

    inFlight = (async (): Promise<PollOutcome> => {
      try {
        const current: HygieneState = await config.storage
          .get()
          .catch(() => ({ ...EMPTY_STATE }));
        const t = now();
        if (t - current.lastFetchedAt < debounceMs) return 'debounced';

        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
        };
        if (current.etag) headers['If-None-Match'] = current.etag;

        const res = await fetchImpl(`${config.apiBase}${ENDPOINT_PATH}`, {
          method: 'GET',
          headers,
          credentials: 'omit',
        });

        if (res.status === 304) {
          await config.storage.set({ ...current, lastFetchedAt: t });
          return 'not-modified';
        }
        if (!res.ok) {
          config.onError?.(new Error(`hygiene summary ${res.status}`));
          return 'error';
        }

        const etag = res.headers.get('ETag');
        const summary = (await res.json()) as HygieneSummary;
        await config.storage.set({
          etag: etag ?? current.etag,
          summary,
          lastFetchedAt: t,
        });
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
      if (doc.visibilityState === 'visible') void poll();
    };
    doc.addEventListener('visibilitychange', handler);
    return () => doc.removeEventListener('visibilitychange', handler);
  }

  return { poll, attachVisibilityListener };
}
