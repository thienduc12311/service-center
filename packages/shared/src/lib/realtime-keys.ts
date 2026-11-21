import { ApiError } from './api-client.js';
import type { PokeObserver } from './realtime-pokes.js';
import type { RealtimeTopicKey } from '../types/domain.js';

/**
 * Private Realtime topics end in a per-organization key that the API serves to active members
 * only and the database rotates when a member is removed (see
 * `20261127000400_w8_realtime_revocation.sql`). A removed member's open socket therefore stops
 * receiving, and a client that is told to rekey (`org:<id>:<key>` poke) refetches the key; a
 * removed member's refetch is refused.
 */
export type RealtimeKeyState =
  | { status: 'loading' }
  | { status: 'ready'; key: string }
  /** The API refused the key: the member was removed, deactivated or signed out. */
  | { status: 'revoked' };

export const REALTIME_KEY_LOADING: RealtimeKeyState = { status: 'loading' };
export const REALTIME_KEY_RETRY_MS = 5_000;

export interface RealtimeKeyStoreOptions {
  /** Fetch the key of the organization the API is currently scoped to. */
  fetchKey: (organizationId: string) => Promise<RealtimeTopicKey>;
  /** Observe topics with the app's Realtime transport; every poke or join calls `refresh`. */
  observe: (refresh: () => Promise<unknown>) => PokeObserver;
}

export interface RealtimeKeyStore {
  /** Stable snapshot for `useSyncExternalStore`. */
  read: (organizationId: string) => RealtimeKeyState;
  /** Start (reference counted) following an organization's key; returns the unsubscribe. */
  watch: (organizationId: string, listener: () => void) => () => void;
}

interface KeyEntry {
  state: RealtimeKeyState;
  listeners: Set<() => void>;
  observer: PokeObserver;
  loading: boolean;
  reload: boolean;
  retry: ReturnType<typeof setTimeout> | undefined;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const KEY = /^[0-9a-f]{64}$/;

export const isRealtimeKey = (value: unknown): value is string => typeof value === 'string' && KEY.test(value);

/** `<resource>:<id>:<key>` for each valid id, distinct and in a stable order. */
export const keyedPokeTopics = (resource: string, ids: readonly string[], key: string | null): string[] =>
  key && isRealtimeKey(key)
    ? [...new Set(ids.filter((id) => UUID.test(id)))].sort().map((id) => `${resource}:${id}:${key}`)
    : [];

export const organizationControlTopic = (organizationId: string, key: string): string | null =>
  UUID.test(organizationId) && isRealtimeKey(key) ? `org:${organizationId}:${key}` : null;

const isRevocation = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);

export const createRealtimeKeyStore = (options: RealtimeKeyStoreOptions): RealtimeKeyStore => {
  const entries = new Map<string, KeyEntry>();

  const publish = (entry: KeyEntry, organizationId: string, state: RealtimeKeyState) => {
    const unchanged = entry.state.status === state.status
      && (entry.state.status !== 'ready' || (state.status === 'ready' && entry.state.key === state.key));
    if (unchanged) return;
    entry.state = state;
    const control = state.status === 'ready' ? organizationControlTopic(organizationId, state.key) : null;
    entry.observer.setTopics(control ? [control] : []);
    for (const listener of entry.listeners) listener();
  };

  const load = async (organizationId: string, entry: KeyEntry): Promise<void> => {
    if (entry.loading) {
      entry.reload = true;
      return;
    }
    entry.loading = true;
    clearTimeout(entry.retry);
    entry.retry = undefined;
    try {
      const { key } = await options.fetchKey(organizationId);
      if (entries.get(organizationId) !== entry) return;
      if (isRealtimeKey(key)) publish(entry, organizationId, { status: 'ready', key });
      else publish(entry, organizationId, { status: 'revoked' });
    } catch (error) {
      if (entries.get(organizationId) !== entry) return;
      if (isRevocation(error)) {
        publish(entry, organizationId, { status: 'revoked' });
      } else {
        // Offline or a server error: keep the last state and ask again shortly.
        entry.retry = setTimeout(() => void load(organizationId, entry), REALTIME_KEY_RETRY_MS);
      }
    } finally {
      entry.loading = false;
      if (entry.reload && entries.get(organizationId) === entry) {
        entry.reload = false;
        void load(organizationId, entry);
      }
    }
  };

  return {
    read: (organizationId) => entries.get(organizationId)?.state ?? REALTIME_KEY_LOADING,
    watch: (organizationId, listener) => {
      let entry = entries.get(organizationId);
      if (!entry) {
        const created: KeyEntry = {
          state: REALTIME_KEY_LOADING,
          listeners: new Set(),
          observer: options.observe(() => load(organizationId, created)),
          loading: false,
          reload: false,
          retry: undefined,
        };
        entry = created;
        entries.set(organizationId, created);
        void load(organizationId, created);
      }
      const watched = entry;
      watched.listeners.add(listener);
      return () => {
        watched.listeners.delete(listener);
        if (watched.listeners.size) return;
        clearTimeout(watched.retry);
        watched.observer.dispose();
        if (entries.get(organizationId) === watched) entries.delete(organizationId);
      };
    },
  };
};
