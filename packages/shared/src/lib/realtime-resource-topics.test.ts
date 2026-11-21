import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client.js';
import type { PokeObserver } from './realtime-pokes.js';
import {
  REALTIME_TOPICS_RETRY_MS,
  createResourceSubscription,
  normalizeResourceIds,
  type ResourceSubscription,
} from './realtime-resource-topics.js';
import type { RealtimeResourceTopicsInput } from '../schemas/realtime.js';
import type { RealtimeResourceTopics } from '../types/domain.js';

const ORG_KEY = 'a1'.repeat(32);
const NEXT_ORG_KEY = 'b2'.repeat(32);
const ONE = '11111111-1111-4111-8111-111111111111';
const TWO = '22222222-2222-4222-8222-222222222222';
const topicOf = (id: string, key: string) => `conversation:${id}:${ORG_KEY}:${key}`;

type Fetch = ReturnType<typeof vi.fn<(input: RealtimeResourceTopicsInput) => Promise<RealtimeResourceTopics>>>;

interface Harness {
  fetchTopics: Fetch;
  topics: string[][];
  refresh: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
  rekey: () => void;
  disposed: ReturnType<typeof vi.fn<() => void>>;
  subscription: ResourceSubscription;
}

const harness = (): Harness => {
  const fetchTopics: Fetch = vi.fn();
  const topics: string[][] = [];
  const disposed = vi.fn<() => void>();
  const refresh = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
  const hooks = { rekey: () => undefined as void };
  const subscription = createResourceSubscription({
    resource: 'conversation',
    fetchTopics,
    refresh,
    observe: (_refresh, onRekey): PokeObserver => {
      hooks.rekey = () => onRekey?.();
      return { setTopics: (next) => topics.push([...next]), dispose: disposed };
    },
  });
  return { fetchTopics, topics, refresh, disposed, subscription, rekey: () => hooks.rekey() };
};

describe('normalizeResourceIds', () => {
  it('keeps valid ids once, sorted, and drops the rest', () => {
    expect(normalizeResourceIds([TWO, 'bad', ONE, TWO])).toEqual([ONE, TWO]);
  });

  it('caps the request at the server limit', () => {
    const many = Array.from({ length: 150 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(normalizeResourceIds(many)).toHaveLength(100);
  });
});

describe('resource subscription', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the API for the topics of the ids and joins the ones it returns', async () => {
    const h = harness();
    h.fetchTopics.mockResolvedValue({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } });
    h.subscription.update([TWO, ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).toHaveBeenCalledWith({ resource: 'conversation', ids: [ONE, TWO] });
    // TWO was left out of the answer: no access, so no topic and no error.
    expect(h.topics.at(-1)).toEqual([topicOf(ONE, 'c1'.repeat(32))]);
  });

  it('joins nothing without an organization key or ids', async () => {
    const h = harness();
    h.subscription.update([ONE], null);
    h.subscription.update([], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).not.toHaveBeenCalled();
    expect(h.topics.at(-1)).toEqual([]);
  });

  it('does not ask again for the same ids and key', async () => {
    const h = harness();
    h.fetchTopics.mockResolvedValue({ topics: {} });
    h.subscription.update([ONE], ORG_KEY);
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).toHaveBeenCalledTimes(1);
  });

  it('moves to the new topic on a rekey poke and refetches only then', async () => {
    const h = harness();
    h.fetchTopics
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } })
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'd2'.repeat(32)) } });
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).toHaveBeenCalledTimes(1);
    h.rekey();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).toHaveBeenCalledTimes(2);
    expect(h.topics.at(-1)).toEqual([topicOf(ONE, 'd2'.repeat(32))]);
  });

  it('leaves the retired topic when the API no longer returns one (access lost)', async () => {
    const h = harness();
    h.fetchTopics
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } })
      .mockResolvedValueOnce({ topics: {} });
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    h.rekey();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.topics.at(-1)).toEqual([]);
  });

  it('refetches when the organization key rotates', async () => {
    const h = harness();
    h.fetchTopics.mockResolvedValue({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } });
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    h.subscription.update([ONE], NEXT_ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.fetchTopics).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that a newer request superseded', async () => {
    const h = harness();
    let resolveFirst: (value: RealtimeResourceTopics) => void = () => undefined;
    h.fetchTopics
      .mockReturnValueOnce(new Promise<RealtimeResourceTopics>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'd2'.repeat(32)) } });
    h.subscription.update([ONE], ORG_KEY);
    h.rekey();
    await vi.advanceTimersByTimeAsync(0);
    resolveFirst({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.topics.at(-1)).toEqual([topicOf(ONE, 'd2'.repeat(32))]);
    expect(h.topics.flat()).not.toContain(topicOf(ONE, 'c1'.repeat(32)));
  });

  it('refuses a topic that does not belong to the requested resource', async () => {
    const h = harness();
    h.fetchTopics.mockResolvedValue({ topics: { [ONE]: topicOf(TWO, 'c1'.repeat(32)) } });
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.topics.at(-1)).toEqual([]);
  });

  it.each([401, 403, 404])('leaves every topic when the API answers %i', async (status) => {
    const h = harness();
    h.fetchTopics.mockRejectedValue(new ApiError(status, 'No'));
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.topics.at(-1)).toEqual([]);
  });

  it('keeps the topics and retries after a transient failure', async () => {
    const h = harness();
    h.fetchTopics
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'c1'.repeat(32)) } })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ topics: { [ONE]: topicOf(ONE, 'd2'.repeat(32)) } });
    h.subscription.update([ONE], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    h.rekey();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.topics.at(-1)).toEqual([topicOf(ONE, 'c1'.repeat(32))]);
    await vi.advanceTimersByTimeAsync(REALTIME_TOPICS_RETRY_MS);
    expect(h.topics.at(-1)).toEqual([topicOf(ONE, 'd2'.repeat(32))]);
  });

  it('stops everything on dispose', async () => {
    const h = harness();
    h.fetchTopics.mockResolvedValue({ topics: {} });
    h.subscription.update([ONE], ORG_KEY);
    h.subscription.dispose();
    h.subscription.update([TWO], ORG_KEY);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.disposed).toHaveBeenCalledTimes(1);
    expect(h.fetchTopics).toHaveBeenCalledTimes(1);
  });
});
