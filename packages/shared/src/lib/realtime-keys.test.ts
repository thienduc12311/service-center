import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client.js';
import {
  REALTIME_KEY_LOADING,
  REALTIME_KEY_RETRY_MS,
  createRealtimeKeyStore,
  keyedPokeTopics,
  organizationControlTopic,
} from './realtime-keys.js';
import type { PokeObserver } from './realtime-pokes.js';
import type { RealtimeTopicKey } from '../types/domain.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const KEY_ONE = 'a1'.repeat(32);
const KEY_TWO = 'b2'.repeat(32);

interface Harness {
  fetchKey: ReturnType<typeof vi.fn<(organizationId: string) => Promise<RealtimeTopicKey>>>;
  refresh: () => Promise<unknown>;
  topics: string[][];
  disposed: ReturnType<typeof vi.fn<() => void>>;
  store: ReturnType<typeof createRealtimeKeyStore>;
}

const harness = (first: Promise<RealtimeTopicKey>): Harness => {
  const fetchKey = vi.fn<(organizationId: string) => Promise<RealtimeTopicKey>>().mockReturnValueOnce(first);
  const topics: string[][] = [];
  const disposed = vi.fn<() => void>();
  const state = { refresh: (): Promise<unknown> => Promise.resolve() };
  const store = createRealtimeKeyStore({
    fetchKey,
    observe: (refresh): PokeObserver => {
      state.refresh = refresh;
      return { setTopics: (next) => topics.push([...next]), dispose: disposed };
    },
  });
  return { fetchKey, topics, disposed, store, get refresh() { return state.refresh; } };
};

describe('keyed poke topics', () => {
  it('appends the key to each valid, distinct id', () => {
    expect(keyedPokeTopics('live_run', [ID, 'bad', ID], KEY_ONE)).toEqual([`live_run:${ID}:${KEY_ONE}`]);
  });

  it('yields no topic without a well-formed key', () => {
    expect(keyedPokeTopics('live_run', [ID], null)).toEqual([]);
    expect(keyedPokeTopics('live_run', [ID], 'short')).toEqual([]);
    expect(organizationControlTopic(ORG, 'short')).toBeNull();
    expect(organizationControlTopic('bad', KEY_ONE)).toBeNull();
  });
});

describe('realtime key store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('serves the key and joins the control topic', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    const listener = vi.fn();
    expect(h.store.read(ORG)).toBe(REALTIME_KEY_LOADING);
    h.store.watch(ORG, listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.read(ORG)).toEqual({ status: 'ready', key: KEY_ONE });
    expect(h.topics).toEqual([[`org:${ORG}:${KEY_ONE}`]]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('refetches on a rekey poke and moves to the new control topic', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    h.fetchKey.mockResolvedValueOnce({ key: KEY_TWO });
    const listener = vi.fn();
    h.store.watch(ORG, listener);
    await vi.advanceTimersByTimeAsync(0);
    await h.refresh();
    expect(h.store.read(ORG)).toEqual({ status: 'ready', key: KEY_TWO });
    expect(h.topics.at(-1)).toEqual([`org:${ORG}:${KEY_TWO}`]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when the refetched key is unchanged', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    h.fetchKey.mockResolvedValueOnce({ key: KEY_ONE });
    const listener = vi.fn();
    h.store.watch(ORG, listener);
    await vi.advanceTimersByTimeAsync(0);
    await h.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks the key revoked and leaves every topic when the API refuses a removed member', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    h.fetchKey.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const listener = vi.fn();
    h.store.watch(ORG, listener);
    await vi.advanceTimersByTimeAsync(0);
    await h.refresh();
    expect(h.store.read(ORG)).toEqual({ status: 'revoked' });
    expect(h.topics.at(-1)).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('treats a %i answer as revoked', async (status) => {
    const h = harness(Promise.reject(new ApiError(status, 'No')));
    h.store.watch(ORG, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.read(ORG)).toEqual({ status: 'revoked' });
  });

  it('keeps the last key and retries after a transient failure', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    h.fetchKey.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ key: KEY_TWO });
    h.store.watch(ORG, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await h.refresh();
    expect(h.store.read(ORG)).toEqual({ status: 'ready', key: KEY_ONE });
    await vi.advanceTimersByTimeAsync(REALTIME_KEY_RETRY_MS);
    expect(h.store.read(ORG)).toEqual({ status: 'ready', key: KEY_TWO });
  });

  it('shares one subscription between watchers and disposes it with the last', async () => {
    const h = harness(Promise.resolve({ key: KEY_ONE }));
    const stopFirst = h.store.watch(ORG, vi.fn());
    const stopSecond = h.store.watch(ORG, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchKey).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(h.disposed).not.toHaveBeenCalled();
    stopSecond();
    expect(h.disposed).toHaveBeenCalledTimes(1);
    expect(h.store.read(ORG)).toBe(REALTIME_KEY_LOADING);
  });

  it('runs one more load when a poke arrives while one is in flight', async () => {
    let resolveFirst: (value: RealtimeTopicKey) => void = () => undefined;
    const h = harness(new Promise<RealtimeTopicKey>((resolve) => { resolveFirst = resolve; }));
    h.fetchKey.mockResolvedValueOnce({ key: KEY_TWO });
    h.store.watch(ORG, vi.fn());
    void h.refresh();
    resolveFirst({ key: KEY_ONE });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchKey).toHaveBeenCalledTimes(2);
    expect(h.store.read(ORG)).toEqual({ status: 'ready', key: KEY_TWO });
  });
});
