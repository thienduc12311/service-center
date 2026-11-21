import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPokeSubscriptions, createRealtimePokeSubscriptions, pokeTopics } from './realtime-pokes.js';

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const KEY = 'ab'.repeat(32);
const topic = `conversation:${id}:${KEY}`;

describe('private poke subscriptions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses exact, distinct topics in a stable order', () => {
    expect(pokeTopics('conversation', [secondId, 'malformed', id, secondId], KEY)).toBe(
      `${topic},conversation:${secondId}:${KEY}`,
    );
    expect(pokeTopics('conversation', [id], null)).toBe('');
    expect(pokeTopics('conversation', [id], 'short')).toBe('');
  });

  it('shares a channel and batches joins and pokes across a list', async () => {
    const callbacks = new Map<string, () => void>();
    const remove = vi.fn(async () => undefined);
    const open = vi.fn((key: string, notify: () => void) => {
      callbacks.set(key, notify);
      return () => remove(key);
    });
    const observe = createPokeSubscriptions(open);
    const readList = vi.fn(async () => undefined);
    const readThread = vi.fn(async () => undefined);
    const list = observe(readList);
    const thread = observe(readThread);
    list.setTopics([topic, `conversation:${secondId}:${KEY}`]);
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
    const nextTopic = `conversation:${secondId}:${KEY}`;
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

  it('checks API access once after a failed join and refreshes again on reconnect', async () => {
    let updateStatus = (_status: string) => {};
    const channel = { subscribe: (onStatus: (status: string) => void) => { updateStatus = onStatus; } };
    const observe = createRealtimePokeSubscriptions({
      authorize: async () => undefined,
      open: () => channel,
      remove: async () => undefined,
    });
    const refresh = vi.fn(async () => undefined);
    const observer = observe(refresh);
    observer.setTopics([topic]);
    await vi.advanceTimersByTimeAsync(0);
    updateStatus('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(50);
    updateStatus('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(1);
    updateStatus('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(2);
    observer.dispose();
  });
});
