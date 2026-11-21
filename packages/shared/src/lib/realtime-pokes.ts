import type { RealtimeResource } from '../schemas/realtime.js';

/** Realtime only signals that a caller should re-read the authenticated API. */
export type PokeResource = RealtimeResource;
export const POKE_FALLBACK_MS = 60_000;
export const POKE_EVENT = 'changed';
// Leave room for a thread outside the list and for channels still leaving.
export const CONVERSATION_LIST_TOPIC_LIMIT = 90;

/**
 * `rekey`: the topic this socket is on has been retired because access changed. Anyone who still
 * has access must ask the API for the current topic; a poke carries no other data.
 */
export type PokeSignal = 'rekey' | 'join-failed' | 'joined';

/** Spread of the refetch after a rekey poke, so a whole organization does not ask at once. */
export const REKEY_JITTER_MS = 2_000;
export const JOIN_RETRY_BASE_MS = 2_000;
export const JOIN_RETRY_MAX_MS = 60_000;

/** Exponential delay for the nth failed join: half fixed, half random, capped. Never zero. */
export const joinRetryDelay = (failures: number, random: () => number): number => {
  const ceiling = Math.min(JOIN_RETRY_MAX_MS, JOIN_RETRY_BASE_MS * 2 ** failures);
  return ceiling / 2 + random() * (ceiling / 2);
};

export interface PokeTiming {
  random: () => number;
}
export type PokeListener = (signal?: PokeSignal) => void;

/** A broadcast message as the Realtime client hands it over; only `payload.event` is read. */
export interface PokeMessage {
  [key: string]: unknown;
  payload?: unknown;
}

/** The signal a received poke carries, if any. */
export const pokeSignalOf = (message: PokeMessage | undefined): PokeSignal | undefined => {
  const payload = message?.payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  return (payload as { event?: unknown }).event === 'rekey' ? 'rekey' : undefined;
};
type CloseChannel = () => Promise<unknown>;
type OpenChannel = (topic: string, notify: PokeListener) => CloseChannel;

interface TopicSubscription {
  listeners: Set<PokeListener>;
  close: CloseChannel;
  closing: boolean;
}

export interface PokeObserver {
  setTopics: (topics: readonly string[]) => void;
  dispose: () => void;
}

interface PokeChannel {
  subscribe: (onStatus: (status: string) => void) => unknown;
}

interface PokeTransport<Channel extends PokeChannel> {
  authorize: () => Promise<void>;
  open: (topic: string, notify: PokeListener) => Channel;
  remove: (channel: Channel) => Promise<unknown>;
}

/**
 * Creates an observer. `onRekey` runs (after a random delay) when a retired topic announces a
 * rekey and when joining a topic keeps failing (a client that was offline during a rotation
 * never hears the poke), the latter with capped exponential backoff.
 */
export type PokeObserverFactory = (refresh: () => Promise<unknown>, onRekey?: () => void) => PokeObserver;

/**
 * Supabase returns the same channel object for repeated calls with a topic.
 * Share it between observers, and wait for leave before reusing a topic.
 */
export const createPokeSubscriptions = (open: OpenChannel, timing: PokeTiming = { random: Math.random }): PokeObserverFactory => {
  const byTopic = new Map<string, TopicSubscription>();

  const connect = (topic: string, listeners: Set<PokeListener>) => {
    const close = open(topic, (signal) => {
      for (const notify of listeners) notify(signal);
    });
    byTopic.set(topic, { listeners, close, closing: false });
  };

  return (refresh, onRekey): PokeObserver => {
    let active = true;
    let topics = new Set<string>();
    let dirty = false;
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rekeyTimer: ReturnType<typeof setTimeout> | undefined;
    let joinFailures = 0;

    const later = (delay: () => number) => {
      if (rekeyTimer !== undefined) return;
      rekeyTimer = setTimeout(() => {
        rekeyTimer = undefined;
        if (!active) return;
        onRekey?.();
        notify();
      }, delay());
    };

    const notify: PokeListener = (signal) => {
      if (!active) return;
      if (signal === 'rekey') return later(() => timing.random() * REKEY_JITTER_MS);
      if (signal === 'join-failed') return later(() => joinRetryDelay(joinFailures++, timing.random));
      if (signal === 'joined') joinFailures = 0;
      dirty = true;
      if (refreshing || timer !== undefined) return;
      // One read for a burst of changes or simultaneous joins on a list.
      timer = setTimeout(() => {
        timer = undefined;
        dirty = false;
        refreshing = true;
        const complete = () => {
          refreshing = false;
          if (dirty) notify();
        };
        void refresh().then(complete, complete);
      }, 50);
    };

    const leave = (topic: string) => {
      const subscription = byTopic.get(topic);
      if (!subscription) return;
      subscription.listeners.delete(notify);
      if (subscription.listeners.size || subscription.closing) return;
      subscription.closing = true;
      const closed = () => {
        if (subscription.listeners.size) connect(topic, subscription.listeners);
        else byTopic.delete(topic);
      };
      void subscription.close().then(closed, closed);
    };

    return {
      setTopics: (nextTopics) => {
        if (!active) return;
        const next = new Set(nextTopics);
        for (const topic of topics) {
          if (!next.has(topic)) leave(topic);
        }
        for (const topic of next) {
          if (topics.has(topic)) continue;
          const subscription = byTopic.get(topic);
          if (subscription) {
            subscription.listeners.add(notify);
            if (!subscription.closing) notify();
          } else {
            connect(topic, new Set([notify]));
          }
        }
        topics = next;
      },
      dispose: () => {
        active = false;
        clearTimeout(timer);
        clearTimeout(rekeyTimer);
        for (const topic of topics) leave(topic);
        topics.clear();
      },
    };
  };
};

export const createRealtimePokeSubscriptions = <Channel extends PokeChannel>(transport: PokeTransport<Channel>, timing?: PokeTiming) => {
  let authorizing: Promise<void> | undefined;
  const authorize = () => authorizing ??= transport.authorize().finally(() => {
    authorizing = undefined;
  });

  return createPokeSubscriptions((topic, notify) => {
    let closed = false;
    const channel = transport.open(topic, notify);
    const join = () => {
      if (closed) return;
      channel.subscribe((status) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') {
          // Refresh after every join, including an SDK reconnect.
          notify('joined');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // The topic may be dead (rotated while offline): the observer re-asks the API with backoff.
          notify('join-failed');
        }
      });
    };
    // The SDK can retry its own token acquisition if the explicit refresh fails.
    void authorize().then(join, join);
    return () => {
      closed = true;
      return transport.remove(channel);
    };
  }, timing);
};
