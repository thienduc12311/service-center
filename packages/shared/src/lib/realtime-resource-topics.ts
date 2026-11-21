import { isRevocation } from './realtime-keys.js';
import type { PokeObserverFactory } from './realtime-pokes.js';
import { REALTIME_TOPIC_REQUEST_LIMIT, type RealtimeResource, type RealtimeResourceTopicsInput } from '../schemas/realtime.js';
import type { RealtimeResourceTopics } from '../types/domain.js';

/**
 * Subscribes one view to the Realtime topics of some resources.
 *
 * Topic names are credentials: the API hands out the current topic of a resource only to someone
 * who can use that resource at that moment (`POST /api/v1/realtime/topics`). A conversation topic
 * is retired when someone loses access to that conversation; the retired topic announces `rekey`
 * and this subscription asks the API again. A person who lost access gets no topic back and
 * leaves the old one. The organization key is passed in only so a rotation of it (which changes
 * every topic) triggers a refetch.
 */
export const REALTIME_TOPICS_RETRY_MS = 5_000;

export interface ResourceSubscriptionOptions {
  resource: RealtimeResource;
  fetchTopics: (input: RealtimeResourceTopicsInput) => Promise<RealtimeResourceTopics>;
  observe: PokeObserverFactory;
  /** Re-read the data the view shows; runs after every poke and join. */
  refresh: () => Promise<unknown>;
}

export interface ResourceSubscription {
  /** The ids to follow under this organization key; `null` or no ids leaves every topic. */
  update: (ids: readonly string[], organizationKey: string | null) => void;
  dispose: () => void;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Valid, distinct ids in a stable order, capped at what one request may ask for. */
export const normalizeResourceIds = (ids: readonly string[]): string[] =>
  [...new Set(ids.filter((id) => UUID.test(id)))].sort().slice(0, REALTIME_TOPIC_REQUEST_LIMIT);

export const createResourceSubscription = (options: ResourceSubscriptionOptions): ResourceSubscription => {
  let ids: string[] = [];
  let organizationKey: string | null = null;
  let active = true;
  let generation = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const reload = async (): Promise<void> => {
    clearTimeout(retry);
    retry = undefined;
    if (!active) return;
    const wanted = ids;
    const current = ++generation;
    if (!organizationKey || wanted.length === 0) {
      observer.setTopics([]);
      return;
    }
    try {
      const { topics } = await options.fetchTopics({ resource: options.resource, ids: wanted });
      // A newer request (an id change or another rekey) supersedes this answer.
      if (!active || current !== generation) return;
      const joined: string[] = [];
      for (const id of wanted) {
        const topic = topics[id];
        if (typeof topic === 'string' && topic.startsWith(`${options.resource}:${id}:`)) joined.push(topic);
      }
      observer.setTopics(joined);
    } catch (error) {
      if (!active || current !== generation) return;
      if (isRevocation(error)) {
        observer.setTopics([]);
      } else {
        // Offline or a server error: stay on the topics we have and ask again shortly.
        retry = setTimeout(() => void reload(), REALTIME_TOPICS_RETRY_MS);
      }
    }
  };

  const observer = options.observe(options.refresh, () => void reload());

  return {
    update: (nextIds, nextKey) => {
      if (!active) return;
      const normalized = normalizeResourceIds(nextIds);
      if (nextKey === organizationKey && normalized.join(',') === ids.join(',')) return;
      ids = normalized;
      organizationKey = nextKey;
      void reload();
    },
    dispose: () => {
      active = false;
      clearTimeout(retry);
      observer.dispose();
    },
  };
};
