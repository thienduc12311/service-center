import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createRealtimePokeSubscriptions, pokeTopics, POKE_EVENT, type PokeObserver, type PokeResource } from '@service-center/shared';
import { supabase } from './supabase';
import { useAuth } from '../providers/AuthProvider';

const observe = createRealtimePokeSubscriptions({
  authorize: () => supabase.realtime.setAuth(),
  open: (topic, notify) => supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: POKE_EVENT }, notify),
  remove: (channel) => supabase.removeChannel(channel),
});

export const useBroadcastRefresh = (
  resource: PokeResource,
  ids: readonly string[],
  visible: boolean,
  filters: QueryFilters,
) => {
  const client = useQueryClient();
  const { queryScope } = useAuth();
  const scope = queryScope && JSON.stringify(queryScope);
  const topics = pokeTopics(resource, ids);
  const observer = useRef<PokeObserver | null>(null);
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !scope) return;
    let active = true;
    const subscription = observe(async () => {
      const current = latestFilters.current;
      if (client.isFetching(current)) {
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
  }, [client, scope, visible]);

  useEffect(() => {
    observer.current?.setTopics(topics ? topics.split(',') : []);
  }, [client, scope, topics, visible]);
};
