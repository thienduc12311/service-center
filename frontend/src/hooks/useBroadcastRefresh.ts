import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createRealtimePokeSubscriptions, pokeTopics, POKE_EVENT, type PokeObserver, type PokeResource } from '@service-center/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';

const observe = createRealtimePokeSubscriptions({
  authorize: () => supabase.realtime.setAuth(),
  open: (topic, notify) => supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: POKE_EVENT }, notify),
  remove: (channel) => supabase.removeChannel(channel),
});

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
  const topics = pokeTopics(resource, ids);
  const observer = useRef<PokeObserver | null>(null);
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !userId || !organizationId) return;
    let active = true;
    const subscription = observe(async () => {
      const current = latestFilters.current;
      if (client.isFetching(current)) {
        // Let an earlier read finish, then read again for a poke received in flight.
        await client.refetchQueries({ ...current, type: 'active', fetchStatus: 'fetching' }, { cancelRefetch: false });
      }
      if (active) await client.invalidateQueries(current, { cancelRefetch: false });
    });
    observer.current = subscription;
    return () => {
      active = false;
      subscription.dispose();
      observer.current = null;
    };
  }, [client, organizationId, userId, visible]);

  useEffect(() => {
    observer.current?.setTopics(topics ? topics.split(',') : []);
  }, [client, organizationId, topics, userId, visible]);
};
