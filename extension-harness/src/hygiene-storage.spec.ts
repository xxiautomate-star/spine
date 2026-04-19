import { describe, it, expect, vi } from 'vitest';
import { createChromeHygieneStore, EMPTY_STATE } from './hygiene-storage';

const enabled = process.env.SPINE_EXT_HARNESS === '1';

function makeLocal(initial: Record<string, unknown> = {}) {
  const bag: Record<string, unknown> = { ...initial };
  return {
    bag,
    get: vi.fn(async (key: string | string[]) => {
      const k = typeof key === 'string' ? key : key[0];
      return { [k]: bag[k] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(bag, items);
    }),
  };
}

describe.skipIf(!enabled)('createChromeHygieneStore', () => {
  it('returns EMPTY_STATE when nothing is stored', async () => {
    const local = makeLocal();
    const store = createChromeHygieneStore(local);
    await expect(store.get()).resolves.toEqual(EMPTY_STATE);
  });

  it('returns EMPTY_STATE when the stored value is not an object', async () => {
    const local = makeLocal({ 'spine:hygiene': 'corrupt' });
    const store = createChromeHygieneStore(local);
    await expect(store.get()).resolves.toEqual(EMPTY_STATE);
  });

  it('returns a parsed state when the stored record is valid', async () => {
    const local = makeLocal({
      'spine:hygiene': {
        etag: '"abc123"',
        summary: {
          plan: 'pro',
          duplicatesPending: 2,
          staleCount: 10,
          clusterCount: 4,
          largestCluster: { label: 'cluster-a', size: 7 },
        },
        lastFetchedAt: 1234,
      },
    });
    const store = createChromeHygieneStore(local);
    const state = await store.get();
    expect(state.etag).toBe('"abc123"');
    expect(state.summary?.duplicatesPending).toBe(2);
    expect(state.lastFetchedAt).toBe(1234);
  });

  it('drops a malformed summary but keeps etag + timestamp', async () => {
    const local = makeLocal({
      'spine:hygiene': {
        etag: '"xyz"',
        summary: { plan: 'free' },
        lastFetchedAt: 42,
      },
    });
    const store = createChromeHygieneStore(local);
    const state = await store.get();
    expect(state.etag).toBe('"xyz"');
    expect(state.summary).toBeNull();
    expect(state.lastFetchedAt).toBe(42);
  });

  it('normalizes missing fields to defaults', async () => {
    const local = makeLocal({ 'spine:hygiene': {} });
    const store = createChromeHygieneStore(local);
    await expect(store.get()).resolves.toEqual(EMPTY_STATE);
  });

  it('writes the full state as a single record under spine:hygiene', async () => {
    const local = makeLocal();
    const store = createChromeHygieneStore(local);
    await store.set({ etag: '"a"', summary: null, lastFetchedAt: 99 });
    expect(local.set).toHaveBeenCalledWith({
      'spine:hygiene': { etag: '"a"', summary: null, lastFetchedAt: 99 },
    });
    expect(local.bag['spine:hygiene']).toEqual({
      etag: '"a"',
      summary: null,
      lastFetchedAt: 99,
    });
  });
});
