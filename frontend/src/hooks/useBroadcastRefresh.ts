import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createRealtimeKeyStore, createRealtimePokeSubscriptions, createResourceSubscription, pokeSignalOf, POKE_EVENT, REALTIME_KEY_LOADING, type PokeResource, type RealtimeKeyState, type ResourceSubscription } from '@service-center/shared';
import { api, getStoredOrganizationId } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';

const observe = createRealtimePokeSubscriptions({
  authorize: () => supabase.realtime.setAuth(),
  open: (topic, notify) => supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: POKE_EVENT }, (message) => notify(pokeSignalOf(message))),
  remove: (channel) => supabase.removeChannel(channel),
});

/** Topic names carry the organization key, which the API withholds from a removed member. */
const keyStore = createRealtimeKeyStore({
  fetchKey: async (organizationId) => {
    // ApiClient.realtimeKey cannot pin an organization yet: refuse to fetch when the active one moved on.
    if (getStoredOrganizationId() !== organizationId) throw new Error('Active organization changed');
    return api.realtimeKey();
  },
  observe,
});

const useRealtimeKey = (organizationId: string | null | undefined): RealtimeKeyState => {
  const subscribe = useCallback(
    (notify: () => void) => (organizationId ? keyStore.watch(organizationId, notify) : () => undefined),
    [organizationId],
  );
  const read = useCallback(
    () => (organizationId ? keyStore.read(organizationId) : REALTIME_KEY_LOADING),
    [organizationId],
  );
  return useSyncExternalStore(subscribe, read);
};

const subscribeToVisibility = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
};
const pageVisible = () => document.visibilityState === 'visible';

export const useBroadcastRefresh = (resource: PokeResource, ids: readonly string[], filters: QueryFilters) => {
  const client = useQueryClient();
  const { session, organizationId } = useAuth();
  const userId = session?.user.id;
  const visible = useSyncExternalStore(subscribeToVisibility, pageVisible);
  const keyState = useRealtimeKey(visible ? organizationId : null);
  const organizationKey = keyState.status === 'ready' ? keyState.key : null;
  const idList = ids.join(',');
  const subscription = useRef<ResourceSubscription | null>(null);
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !userId || !organizationId) return;
    let active = true;
    const created = createResourceSubscription({
      resource,
      observe,
      // The API decides which topics this person may join, on every request.
      fetchTopics: (input) => api.realtimeTopics(input),
      refresh: async () => {
        const current = latestFilters.current;
        if (client.isFetching(current)) {
          // Let an earlier read finish, then read again for a poke received in flight.
          await client.refetchQueries({ ...current, type: 'active', fetchStatus: 'fetching' }, { cancelRefetch: false });
        }
        if (active) await client.invalidateQueries(current, { cancelRefetch: false });
      },
    });
    subscription.current = created;
    return () => {
      active = false;
      created.dispose();
      subscription.current = null;
    };
  }, [client, organizationId, resource, userId, visible]);

  useEffect(() => {
    subscription.current?.update(idList ? idList.split(',') : [], organizationKey);
  }, [client, idList, organizationId, organizationKey, resource, userId, visible]);
};
