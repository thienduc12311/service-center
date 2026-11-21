import { keyedPokeTopics } from './realtime-keys.js';

/** Realtime only signals that a caller should re-read the authenticated API. */
export type PokeResource = 'conversation' | 'live_run' | 'live_plan';
export const POKE_FALLBACK_MS = 60_000;
export const POKE_EVENT = 'changed';
// Leave room for a thread outside the list and for channels still leaving.
export const CONVERSATION_LIST_TOPIC_LIMIT = 90;

type PokeListener = () => void;
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

/** Comma-joined topics (`<resource>:<id>:<org key>`); empty until the organization key is known. */
export const pokeTopics = (resource: PokeResource, ids: readonly string[], key: string | null): string =>
  keyedPokeTopics(resource, ids, key).join(',');

/**
 * Supabase returns the same channel object for repeated calls with a topic.
 * Share it between observers, and wait for leave before reusing a topic.
 */
export const createPokeSubscriptions = (open: OpenChannel) => {
  const byTopic = new Map<string, TopicSubscription>();

  const connect = (topic: string, listeners: Set<PokeListener>) => {
    const close = open(topic, () => {
      for (const notify of listeners) notify();
    });
    byTopic.set(topic, { listeners, close, closing: false });
  };

  return (refresh: () => Promise<unknown>): PokeObserver => {
    let active = true;
    let topics = new Set<string>();
    let dirty = false;
    let refreshing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const notify = () => {
      if (!active) return;
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
        for (const topic of topics) leave(topic);
        topics.clear();
      },
    };
  };
};

export const createRealtimePokeSubscriptions = <Channel extends PokeChannel>(transport: PokeTransport<Channel>) => {
  let authorizing: Promise<void> | undefined;
  const authorize = () => authorizing ??= transport.authorize().finally(() => {
    authorizing = undefined;
  });

  return createPokeSubscriptions((topic, notify) => {
    let closed = false;
    let joinFailed = false;
    const channel = transport.open(topic, notify);
    const join = () => {
      if (closed) return;
      channel.subscribe((status) => {
        if (closed) return;
        if (status === 'SUBSCRIBED') {
          joinFailed = false;
          // Refresh after every join, including an SDK reconnect.
          notify();
        } else if (!joinFailed && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          joinFailed = true;
          // Check access through the API once while the SDK retries the join.
          notify();
        }
      });
    };
    // The SDK can retry its own token acquisition if the explicit refresh fails.
    void authorize().then(join, join);
    return () => {
      closed = true;
      return transport.remove(channel);
    };
  });
};
