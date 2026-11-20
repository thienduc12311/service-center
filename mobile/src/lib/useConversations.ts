import { useQuery } from '@tanstack/react-query';
import { CONVERSATION_LIST_POLL_MS, CONVERSATION_LIST_TOPIC_LIMIT, conversationAccess } from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useBroadcastRefresh } from './useBroadcastRefresh';
import { useScreenVisible } from './useScreenVisible';

export const useConversations = () => {
  const { queryScope } = useAuth();
  const visible = useScreenVisible();
  const queryKey = queryKeys.conversationList(queryScope);
  const query = useQuery({
    queryKey,
    queryFn: () => api.conversations(),
    enabled: Boolean(queryScope && visible),
    staleTime: 0,
    refetchInterval: visible ? CONVERSATION_LIST_POLL_MS : false,
  });
  const data = conversationAccess(query.error) === 'unavailable' ? undefined : query.data;
  useBroadcastRefresh('conversation', data?.slice(0, CONVERSATION_LIST_TOPIC_LIMIT).map((conversation) => conversation.id) ?? [], visible, { queryKey, exact: true });
  return { ...query, data };
};
