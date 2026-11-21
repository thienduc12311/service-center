import { useInfiniteQuery } from '@tanstack/react-query';
import {
  CONVERSATION_LIST_POLL_MS,
  CONVERSATION_LIST_TOPIC_LIMIT,
  conversationAccess,
  flattenConversationPages,
} from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useBroadcastRefresh } from './useBroadcastRefresh';
import { useScreenVisible } from './useScreenVisible';

/**
 * Keyset-paged (W8-PERF-D3): `data` is every page loaded so far; call
 * `fetchNextPage` while `hasNextPage` so no conversation is unreachable.
 */
export const useConversations = () => {
  const { queryScope } = useAuth();
  const visible = useScreenVisible();
  const queryKey = queryKeys.conversationList(queryScope);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.conversationsPage({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(queryScope && visible),
    staleTime: 0,
    refetchInterval: visible ? CONVERSATION_LIST_POLL_MS : false,
  });
  const loaded = query.data ? flattenConversationPages(query.data.pages) : undefined;
  const data = conversationAccess(query.error) === 'unavailable' ? undefined : loaded;
  useBroadcastRefresh('conversation', data?.slice(0, CONVERSATION_LIST_TOPIC_LIMIT).map((conversation) => conversation.id) ?? [], visible, { queryKey, exact: true });
  return { ...query, data };
};
