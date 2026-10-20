import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/** MOB-011: grants the signed-in Person gave and received in the active organization (revoked ones excluded). */
export const useDelegations = () => {
  const { queryScope } = useAuth();
  return useQuery({
    queryKey: queryKeys.delegations(queryScope),
    queryFn: () => api.listDelegations(),
    enabled: Boolean(queryScope),
  });
};

/** Released requests of the Person behind an active grant; never plan items, notes or files. */
export const useDelegatedSchedule = (delegationId: string | null | undefined, enabled: boolean) => {
  const { queryScope } = useAuth();
  return useQuery({
    queryKey: queryKeys.delegatedSchedule(queryScope, delegationId),
    queryFn: () => api.delegatedSchedule(delegationId!),
    enabled: Boolean(queryScope && delegationId && enabled),
  });
};

/**
 * After a grant, revoke or delegated change: re-read the grants and every
 * delegated schedule, so a stopped grant disappears everywhere at once.
 */
export const useRefreshDelegations = () => {
  const { queryScope } = useAuth();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.delegations(queryScope) });
};
