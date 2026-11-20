import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createPokeSubscriptions, pokeTopics, POKE_EVENT, type PokeResource } from '@service-center/shared';
import { supabase } from './supabase';
import { useAuth } from '../providers/AuthProvider';

let authorizing: Promise<void> | undefined;
const authorize = () => authorizing ??= supabase.realtime.setAuth().finally(() => {
  authorizing = undefined;
});

const subscribe = createPokeSubscriptions((topic, notify) => {
  let closed = false;
  const channel = supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: POKE_EVENT }, notify);
  void authorize().then(() => {
    if (closed) return;
    channel.subscribe((status) => {
      // Read after every join, including on a restored session or reconnect.
      if (status === 'SUBSCRIBED') notify();
    });
  }).catch(() => {
    // The authenticated API continues refreshing on the fallback interval.
  });
  return () => {
    closed = true;
    return supabase.removeChannel(channel);
  };
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
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !scope || !topics) return;
    let active = true;
    const cleanup = subscribe(topics.split(','), async () => {
      const current = latestFilters.current;
      if (client.isFetching(current)) {
        await client.refetchQueries({ ...current, type: 'active', fetchStatus: 'fetching' }, { cancelRefetch: false });
      }
      if (active) await client.invalidateQueries(current, { cancelRefetch: false });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [client, scope, topics, visible]);
};
