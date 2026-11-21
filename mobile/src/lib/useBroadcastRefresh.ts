import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createRealtimeKeyStore, createRealtimePokeSubscriptions, createResourceSubscription, pokeSignalOf, POKE_EVENT, REALTIME_KEY_LOADING, type PokeResource, type RealtimeKeyState, type ResourceSubscription } from '@service-center/shared';
import { api } from './api';
import { supabase } from './supabase';
import { useAuth } from '../providers/AuthProvider';

const observe = createRealtimePokeSubscriptions({
  authorize: () => supabase.realtime.setAuth(),
  open: (topic, notify) => supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: POKE_EVENT }, (message) => notify(pokeSignalOf(message))),
  remove: (channel) => supabase.removeChannel(channel),
});

/** Topic names carry the organization key, which the API withholds from a removed member. */
const keyStore = createRealtimeKeyStore({
  // Pin the request to the organization the key is for, whatever church is active now.
  fetchKey: (organizationId) => api.realtimeKey({ organizationId }),
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

export const useBroadcastRefresh = (
  resource: PokeResource,
  ids: readonly string[],
  visible: boolean,
  filters: QueryFilters,
) => {
  const client = useQueryClient();
  const { queryScope } = useAuth();
  const scope = queryScope && JSON.stringify(queryScope);
  const keyState = useRealtimeKey(visible ? queryScope?.organizationId : null);
  const organizationKey = keyState.status === 'ready' ? keyState.key : null;
  const idList = ids.join(',');
  const subscription = useRef<ResourceSubscription | null>(null);
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !scope) return;
    let active = true;
    const created = createResourceSubscription({
      resource,
      observe,
      // The API decides which topics this person may join, on every request.
      fetchTopics: (input) => api.realtimeTopics(input),
      refresh: async () => {
        const current = latestFilters.current;
        if (client.isFetching(current)) {
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
  }, [client, resource, scope, visible]);

  useEffect(() => {
    subscription.current?.update(idList ? idList.split(',') : [], organizationKey);
  }, [client, idList, organizationKey, resource, scope, visible]);
};
