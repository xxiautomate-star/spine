import { describe, it, expect, vi } from 'vitest';
import { createHygienePoller } from './content';
import {
  EMPTY_STATE,
  type HygieneState,
  type HygieneSummary,
  type StorageAdapter,
} from './hygiene-storage';

const enabled = process.env.SPINE_EXT_HARNESS === '1';

const zeroSummary: HygieneSummary = {
  plan: 'free',
  duplicatesPending: 0,
  staleCount: 0,
  clusterCount: 0,
  largestCluster: null,
};

function makeStorage(initial: HygieneState = { ...EMPTY_STATE }): StorageAdapter & {
  state: HygieneState;
} {
  const state: HygieneState = { ...initial };
  return {
    state,
    get: vi.fn(async () => ({ ...state })),
    set: vi.fn(async (next: HygieneState) => {
      state.etag = next.etag;
      state.summary = next.summary;
      state.lastFetchedAt = next.lastFetchedAt;
    }),
  };
}

type ResponseInit = { status?: number; etag?: string };

function makeResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Map<string, string>();
  if (init.etag) headers.set('etag', init.etag);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

describe.skipIf(!enabled)('createHygienePoller', () => {
  it('returns no-key when apiKey is null', async () => {
    const storage = makeStorage();
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: null,
      storage,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(poller.poll()).resolves.toBe('no-key');
  });

  it('returns debounced when within the debounce window', async () => {
    const storage = makeStorage({ etag: null, summary: null, lastFetchedAt: 1_000 });
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 10_000,
      debounceMs: 30_000,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(poller.poll()).resolves.toBe('debounced');
  });

  it('fetches, stores etag + summary, and invokes onSummary', async () => {
    const storage = makeStorage();
    const summary: HygieneSummary = {
      plan: 'pro',
      duplicatesPending: 1,
      staleCount: 2,
      clusterCount: 3,
      largestCluster: null,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(summary, { status: 200, etag: '"new"' })) as unknown as typeof fetch;
    const onSummary = vi.fn();
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 50_000,
      fetchImpl,
      onSummary,
    });
    await expect(poller.poll()).resolves.toBe('fetched');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(storage.state.etag).toBe('"new"');
    expect(storage.state.summary).toEqual(summary);
    expect(storage.state.lastFetchedAt).toBe(50_000);
    expect(onSummary).toHaveBeenCalledWith(summary);
  });

  it('sends If-None-Match when an etag is already stored', async () => {
    const storage = makeStorage({ etag: '"stored"', summary: null, lastFetchedAt: 0 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(null, { status: 304 })) as unknown as typeof fetch;
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 100_000,
      fetchImpl,
    });
    await poller.poll();
    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const init = mock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['If-None-Match']).toBe('"stored"');
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('handles 304 by bumping lastFetchedAt and preserving etag', async () => {
    const storage = makeStorage({
      etag: '"keep"',
      summary: zeroSummary,
      lastFetchedAt: 0,
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(null, { status: 304 })) as unknown as typeof fetch;
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 77_000,
      fetchImpl,
    });
    await expect(poller.poll()).resolves.toBe('not-modified');
    expect(storage.state.etag).toBe('"keep"');
    expect(storage.state.lastFetchedAt).toBe(77_000);
  });

  it('returns error and fires onError on a non-ok response', async () => {
    const storage = makeStorage();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({}, { status: 500 })) as unknown as typeof fetch;
    const onError = vi.fn();
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 100_000,
      fetchImpl,
      onError,
    });
    await expect(poller.poll()).resolves.toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('returns error when fetch itself throws', async () => {
    const storage = makeStorage();
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const onError = vi.fn();
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 100_000,
      fetchImpl,
      onError,
    });
    await expect(poller.poll()).resolves.toBe('error');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('collapses concurrent polls onto a single in-flight fetch', async () => {
    const storage = makeStorage();
    let resolveFetch!: (r: Response) => void;
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 100_000,
      fetchImpl,
    });
    const a = poller.poll();
    const b = poller.poll();
    // Flush microtasks so the poller's async IIFE reaches fetchImpl
    // before we try to resolve the request body.
    await new Promise((r) => setTimeout(r, 0));
    resolveFetch(makeResponse(zeroSummary, { status: 200 }));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('fetched');
    expect(rb).toBe('fetched');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('attachVisibilityListener triggers poll only when visible, and detaches cleanly', async () => {
    const storage = makeStorage();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse(zeroSummary, { status: 200 })) as unknown as typeof fetch;
    const poller = createHygienePoller({
      apiBase: 'https://s',
      apiKey: 'k',
      storage,
      now: () => 100_000,
      fetchImpl,
    });

    let visibility: 'visible' | 'hidden' = 'hidden';
    const listeners: Array<() => void> = [];
    const removeEventListener = vi.fn();
    const fakeDoc = {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_t: string, h: () => void) => {
        listeners.push(h);
      },
      removeEventListener,
    } as unknown as Document;

    const detach = poller.attachVisibilityListener(fakeDoc);

    // hidden -> no fetch
    listeners[0]();
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();

    // visible -> fetch fires
    visibility = 'visible';
    listeners[0]();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    detach();
    expect(removeEventListener).toHaveBeenCalled();
  });
});
