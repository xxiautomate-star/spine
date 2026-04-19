// chrome.storage.local adapter for the hygiene poll state.
//
// The content script and the background service worker both need to
// read + write the last ETag + payload. chrome.storage.local is the
// only surface they share directly; localStorage is scoped per-origin
// and invisible to the background worker. Single key keeps atomicity
// trivial — every write is a full replacement.

const STORAGE_KEY = 'spine:hygiene';

export type HygieneSummary = {
  plan: string;
  duplicatesPending: number;
  staleCount: number;
  clusterCount: number;
  largestCluster: { label: string; size: number } | null;
};

export type HygieneState = {
  etag: string | null;
  summary: HygieneSummary | null;
  lastFetchedAt: number;
};

export const EMPTY_STATE: HygieneState = {
  etag: null,
  summary: null,
  lastFetchedAt: 0,
};

export type StorageAdapter = {
  get(): Promise<HygieneState>;
  set(state: HygieneState): Promise<void>;
};

// Small shape the adapter needs — lets tests pass a fake without
// pulling the full chrome.storage typings through the boundary.
type ChromeLocalLike = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export function createChromeHygieneStore(
  local: ChromeLocalLike = chrome.storage.local
): StorageAdapter {
  return {
    async get(): Promise<HygieneState> {
      const bag = await local.get(STORAGE_KEY);
      const raw = bag[STORAGE_KEY];
      if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
      const candidate = raw as Partial<HygieneState>;
      return {
        etag: typeof candidate.etag === 'string' ? candidate.etag : null,
        summary: isSummary(candidate.summary) ? candidate.summary : null,
        lastFetchedAt:
          typeof candidate.lastFetchedAt === 'number' ? candidate.lastFetchedAt : 0,
      };
    },
    async set(state: HygieneState): Promise<void> {
      await local.set({ [STORAGE_KEY]: state });
    },
  };
}

function isSummary(value: unknown): value is HygieneSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.plan === 'string' &&
    typeof v.duplicatesPending === 'number' &&
    typeof v.staleCount === 'number' &&
    typeof v.clusterCount === 'number'
  );
}
