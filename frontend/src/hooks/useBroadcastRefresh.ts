import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryFilters } from '@tanstack/react-query';
import { createPokeSubscriptions, pokeTopics, POKE_EVENT, type PokeResource } from '@service-center/shared';
import { supabase } from '../lib/supabase';
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
  const latestFilters = useRef(filters);
  latestFilters.current = filters;

  useEffect(() => {
    if (!visible || !userId || !organizationId || !topics) return;
    let active = true;
    const cleanup = subscribe(topics.split(','), async () => {
      const current = latestFilters.current;
      if (client.isFetching(current)) {
        // Let an earlier read finish, then read again for a poke received in flight.
        await client.refetchQueries({ ...current, type: 'active', fetchStatus: 'fetching' }, { cancelRefetch: false });
      }
      if (active) await client.invalidateQueries(current, { cancelRefetch: false });
    });
    return () => {
      active = false;
      cleanup();
    };
  }, [client, organizationId, topics, userId, visible]);
};
