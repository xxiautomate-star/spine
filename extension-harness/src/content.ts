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

import type { HygieneState, HygieneSummary, StorageAdapter } from './hygiene-storage';
import { EMPTY_STATE } from './hygiene-storage';

const POLL_DEBOUNCE_MS = 30_000;
const ENDPOINT_PATH = '/api/hygiene/summary';

type PollOutcome = 'fetched' | 'not-modified' | 'debounced' | 'no-key' | 'error';

type PollerConfig = {
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

  async function poll(): Promise<PollOutcome> {
    if (!config.apiKey) return 'no-key';
    if (inFlight) return inFlight;

    const current: HygieneState = await config.storage.get().catch(() => ({
      ...EMPTY_STATE,
    }));
    const t = now();
    if (t - current.lastFetchedAt < debounceMs) return 'debounced';

    inFlight = (async (): Promise<PollOutcome> => {
      try {
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
          // Bump lastFetchedAt so the debounce window covers 304s too.
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
      if (doc.visibilityState === 'visible') {
        void poll();
      }
    };
    doc.addEventListener('visibilitychange', handler);
    return () => doc.removeEventListener('visibilitychange', handler);
  }

  return { poll, attachVisibilityListener };
}
