import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REKEY_JITTER_MS, JOIN_RETRY_MAX_MS, createPokeSubscriptions, createRealtimePokeSubscriptions, joinRetryDelay, pokeSignalOf, type PokeListener } from './realtime-pokes.js';

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const KEY = 'ab'.repeat(32);
const topic = `conversation:${id}:${KEY}:${'cd'.repeat(32)}`;

describe('private poke subscriptions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads a rekey signal from the poke payload only', () => {
    expect(pokeSignalOf({ payload: { event: 'rekey' } })).toBe('rekey');
    expect(pokeSignalOf({ payload: { id, event: 'changed' } })).toBeUndefined();
    expect(pokeSignalOf({ payload: null })).toBeUndefined();
    expect(pokeSignalOf({ payload: 'rekey' })).toBeUndefined();
    expect(pokeSignalOf(undefined)).toBeUndefined();
  });

  it('runs the rekey callback after a random delay under the jitter cap and still refreshes the data', async () => {
    const notifiers = new Map<string, PokeListener>();
    const observe = createPokeSubscriptions((key, notify) => {
      notifiers.set(key, notify);
      return async () => undefined;
    }, { random: () => 0.5 });
    const refresh = vi.fn(async () => undefined);
    const onRekey = vi.fn();
    const observer = observe(refresh, onRekey);
    observer.setTopics([topic]);
    notifiers.get(topic)?.();
    expect(onRekey).not.toHaveBeenCalled();
    notifiers.get(topic)?.('rekey');
    await vi.advanceTimersByTimeAsync(REKEY_JITTER_MS / 2 - 1);
    expect(onRekey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onRekey).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    // One for the plain poke before, one after the delayed rekey.
    expect(refresh).toHaveBeenCalledTimes(2);
    observer.dispose();
  });

  it('shares a channel and batches joins and pokes across a list', async () => {
    const callbacks = new Map<string, PokeListener>();
    const remove = vi.fn(async () => undefined);
    const open = vi.fn((key: string, notify: PokeListener) => {
      callbacks.set(key, notify);
      return () => remove(key);
    });
    const observe = createPokeSubscriptions(open);
    const readList = vi.fn(async () => undefined);
    const readThread = vi.fn(async () => undefined);
    const list = observe(readList);
    const thread = observe(readThread);
    list.setTopics([topic, `conversation:${secondId}:${KEY}:${KEY}`]);
    thread.setTopics([topic]);

    for (const notify of callbacks.values()) notify();
    callbacks.get(topic)?.();
    await vi.advanceTimersByTimeAsync(50);
    expect(open).toHaveBeenCalledTimes(2);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledTimes(1);

    thread.dispose();
    expect(remove).not.toHaveBeenCalled();
    callbacks.get(topic)?.();
    list.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('keeps unchanged topics joined as the list changes', async () => {
    const leave = vi.fn(async () => undefined);
    const open = vi.fn((key: string) => () => leave(key));
    const list = createPokeSubscriptions(open)(async () => undefined);
    const nextTopic = `conversation:${secondId}:${KEY}:${KEY}`;
    list.setTopics([topic]);
    list.setTopics([topic, nextTopic]);
    list.setTopics([nextTopic]);
    expect(open.mock.calls).toEqual([[topic, expect.any(Function)], [nextTopic, expect.any(Function)]]);
    expect(leave.mock.calls).toEqual([[topic]]);
    list.dispose();
  });

  it('performs a trailing read when a poke arrives during a request', async () => {
    let notify = () => {};
    let finish = () => {};
    const observe = createPokeSubscriptions((_topic, signal) => {
      notify = signal;
      return async () => undefined;
    });
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const observer = observe(refresh);
    observer.setTopics([topic]);
    notify();
    await vi.advanceTimersByTimeAsync(50);
    notify();
    notify();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(2);
    observer.dispose();
    finish();
  });

  it('waits for a previous leave before rejoining the same topic', async () => {
    let left = () => {};
    const open = vi.fn((_topic: string, _notify: () => void) => () => new Promise<void>((resolve) => { left = resolve; }));
    const observe = createPokeSubscriptions(open);
    const refresh = async () => undefined;
    const first = observe(refresh);
    first.setTopics([topic]);
    first.dispose();
    const second = observe(refresh);
    second.setTopics([topic]);
    expect(open).toHaveBeenCalledTimes(1);
    left();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(2);
    second.dispose();
    left();
  });

  it('re-asks the API with growing, capped delays while joins keep failing, and resets on success', async () => {
    let updateStatus = (_status: string) => {};
    const channel = { subscribe: (onStatus: (status: string) => void) => { updateStatus = onStatus; } };
    const observe = createRealtimePokeSubscriptions({
      authorize: async () => undefined,
      open: () => channel,
      remove: async () => undefined,
    }, { random: () => 0 });
    const refresh = vi.fn(async () => undefined);
    const onRekey = vi.fn();
    const observer = observe(refresh, onRekey);
    observer.setTopics([topic]);
    await vi.advanceTimersByTimeAsync(0);
    // random 0: delay is half the ceiling, 2s * 2^n / 2 => 1s, 2s, 4s ...
    updateStatus('CHANNEL_ERROR');
    updateStatus('TIMED_OUT'); // ignored while a retry is pending
    await vi.advanceTimersByTimeAsync(999);
    expect(onRekey).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onRekey).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(1);
    updateStatus('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(onRekey).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onRekey).toHaveBeenCalledTimes(2);
    // A good join resets the backoff.
    updateStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(50);
    updateStatus('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onRekey).toHaveBeenCalledTimes(3);
    observer.dispose();
  });

  it('never retries tighter than the base delay or looser than the cap', () => {
    expect(joinRetryDelay(0, () => 0)).toBeGreaterThan(0);
    for (const failures of [0, 3, 10, 50]) {
      expect(joinRetryDelay(failures, () => 1)).toBeLessThanOrEqual(JOIN_RETRY_MAX_MS);
    }
    expect(joinRetryDelay(50, () => 0)).toBe(JOIN_RETRY_MAX_MS / 2);
  });

  it('stops a pending retry on dispose', async () => {
    const notifiers = new Map<string, PokeListener>();
    const observe = createPokeSubscriptions((key, notify) => {
      notifiers.set(key, notify);
      return async () => undefined;
    }, { random: () => 0 });
    const onRekey = vi.fn();
    const observer = observe(vi.fn(async () => undefined), onRekey);
    observer.setTopics([topic]);
    notifiers.get(topic)?.('join-failed');
    observer.dispose();
    await vi.advanceTimersByTimeAsync(JOIN_RETRY_MAX_MS);
    expect(onRekey).not.toHaveBeenCalled();
  });
});
