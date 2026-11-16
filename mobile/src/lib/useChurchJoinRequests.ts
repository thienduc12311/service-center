import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MyChurchJoinRequest } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/** The signed-in login's requests to join churches, newest first. Asked before joining any church. */
export const useMyChurchJoinRequests = (): UseQueryResult<MyChurchJoinRequest[]> => {
  const { user, ready } = useAuth();
  const userId = user?.profile.id;
  return useQuery({
    queryKey: queryKeys.churchJoinRequests(userId),
    queryFn: () => api.myChurchJoinRequests(),
    enabled: ready && Boolean(userId),
  });
};
