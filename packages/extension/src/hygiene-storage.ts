// chrome.storage.local adapter for hygiene poll state.
//
// Promoted from extension-harness/src/hygiene-storage.ts.
// Harness keeps its own copy so specs remain isolated; this copy
// evolves with the real extension.

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
      const c = raw as Partial<HygieneState>;
      return {
        etag: typeof c.etag === 'string' ? c.etag : null,
        summary: isSummary(c.summary) ? c.summary : null,
        lastFetchedAt: typeof c.lastFetchedAt === 'number' ? c.lastFetchedAt : 0,
      };
    },
    async set(state: HygieneState): Promise<void> {
      await local.set({ [STORAGE_KEY]: state });
    },
  };
}

function isSummary(v: unknown): v is HygieneSummary {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.plan === 'string' &&
    typeof r.duplicatesPending === 'number' &&
    typeof r.staleCount === 'number' &&
    typeof r.clusterCount === 'number'
  );
}
