import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/** MOB-010: every replacement request this Person may see, after the server's lazy expiry. */
export const useReplacementRequests = () => {
  const { queryScope } = useAuth();
  return useQuery({
    queryKey: queryKeys.replacements(queryScope),
    queryFn: () => api.listReplacementRequests(),
    enabled: Boolean(queryScope),
  });
};

/** The roster, for names and the signed-in account's own Person. */
export const usePeople = () => {
  const { queryScope } = useAuth();
  return useQuery({
    queryKey: queryKeys.people(queryScope),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope),
  });
};

/** The signed-in account's Person in the active organization, once the roster has loaded. */
export const useMyPersonId = (): string | null => {
  const { queryScope } = useAuth();
  const people = usePeople();
  const userId = queryScope?.userId ?? null;
  return (userId && people.data?.find((person) => person.profile_id === userId)?.person_id) || null;
};

/** After any replacement change: the requests, the schedule (a finalized offer is a new assignment) and the plan. */
export const useRefreshAfterReplacement = () => {
  const { queryScope } = useAuth();
  const queryClient = useQueryClient();
  return async (planId: string | null | undefined) => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.replacements(queryScope) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) });
    if (planId) await queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, planId) });
  };
};
