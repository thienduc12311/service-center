import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPokeSubscriptions, pokeTopics } from './realtime-pokes.js';

const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const topic = `conversation:${id}`;

describe('private poke subscriptions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uses exact, distinct topics in a stable order', () => {
    expect(pokeTopics('conversation', [secondId, 'malformed', id, secondId])).toBe(
      `${topic},conversation:${secondId}`,
    );
  });

  it('shares a channel and batches joins and pokes across a list', async () => {
    const callbacks = new Map<string, () => void>();
    const remove = vi.fn(async () => undefined);
    const open = vi.fn((key: string, notify: () => void) => {
      callbacks.set(key, notify);
      return () => remove(key);
    });
    const subscribe = createPokeSubscriptions(open);
    const readList = vi.fn(async () => undefined);
    const readThread = vi.fn(async () => undefined);
    const disposeList = subscribe([topic, `conversation:${secondId}`], readList);
    const disposeThread = subscribe([topic], readThread);

    for (const notify of callbacks.values()) notify();
    callbacks.get(topic)?.();
    await vi.advanceTimersByTimeAsync(50);
    expect(open).toHaveBeenCalledTimes(2);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledTimes(1);

    disposeThread();
    expect(remove).not.toHaveBeenCalled();
    callbacks.get(topic)?.();
    disposeList();
    await vi.advanceTimersByTimeAsync(50);
    expect(readList).toHaveBeenCalledTimes(1);
    expect(readThread).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('performs a trailing read when a poke arrives during a request', async () => {
    let notify = () => {};
    let finish = () => {};
    const subscribe = createPokeSubscriptions((_topic, signal) => {
      notify = signal;
      return async () => undefined;
    });
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const dispose = subscribe([topic], refresh);
    notify();
    await vi.advanceTimersByTimeAsync(50);
    notify();
    notify();
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(50);
    expect(refresh).toHaveBeenCalledTimes(2);
    dispose();
    finish();
  });

  it('waits for a previous leave before rejoining the same topic', async () => {
    let left = () => {};
    const open = vi.fn((_topic: string, _notify: () => void) => () => new Promise<void>((resolve) => { left = resolve; }));
    const subscribe = createPokeSubscriptions(open);
    const refresh = async () => undefined;
    subscribe([topic], refresh)();
    const dispose = subscribe([topic], refresh);
    expect(open).toHaveBeenCalledTimes(1);
    left();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(2);
    dispose();
    left();
  });
});
