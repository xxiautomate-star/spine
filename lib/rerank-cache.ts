// Tiny in-process LRU cache for cross-encoder rerank results. Keyed by the
// query + sorted candidate-id list so two calls with the same shortlist reuse
// the score. TTL caps staleness. Multi-instance deploys get independent
// caches — that's acceptable; the upstream cross-encoder call is idempotent.

import { createHash } from 'node:crypto';

type Entry<T> = {
  value: T;
  expiresAt: number;
};

const DEFAULT_MAX = 512;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

const store = new Map<string, Entry<unknown>>();

export function cacheKey(query: string, candidateIds: string[]): string {
  const ids = [...candidateIds].sort().join(',');
  return createHash('sha1').update(`${query}||${ids}`).digest('hex');
}

export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  // Touch — refresh LRU order
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

export function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  if (store.size >= DEFAULT_MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheStats() {
  let hits = 0;
  let total = 0;
  const now = Date.now();
  for (const entry of store.values()) {
    total++;
    if (entry.expiresAt > now) hits++;
  }
  return { size: store.size, live: hits, expired: total - hits };
}

export function clearCache(): void {
  store.clear();
}
