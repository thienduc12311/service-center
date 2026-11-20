/** Realtime only signals that a caller should re-read the authenticated API. */
export type PokeResource = 'conversation' | 'live_run' | 'live_plan';
export const POKE_FALLBACK_MS = 60_000;
export const POKE_EVENT = 'changed';

type PokeListener = () => void;
type CloseChannel = () => Promise<unknown>;
type OpenChannel = (topic: string, notify: PokeListener) => CloseChannel;

interface TopicSubscription {
  listeners: Set<PokeListener>;
  close: CloseChannel;
  closing: boolean;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export const pokeTopics = (resource: PokeResource, ids: readonly string[]): string =>
  [...new Set(ids.filter((id) => UUID.test(id)))].sort().map((id) => `${resource}:${id}`).join(',');

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

  return (topics: readonly string[], refresh: () => Promise<unknown>): (() => void) => {
    let active = true;
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

    for (const topic of topics) {
      const subscription = byTopic.get(topic);
      if (subscription) {
        subscription.listeners.add(notify);
        if (!subscription.closing) notify();
      } else {
        connect(topic, new Set([notify]));
      }
    }

    return () => {
      active = false;
      clearTimeout(timer);
      for (const topic of topics) {
        const subscription = byTopic.get(topic);
        if (!subscription) continue;
        subscription.listeners.delete(notify);
        if (subscription.listeners.size || subscription.closing) continue;
        subscription.closing = true;
        const closed = () => {
          if (subscription.listeners.size) connect(topic, subscription.listeners);
          else byTopic.delete(topic);
        };
        void subscription.close().then(closed, closed);
      }
    };
  };
};
