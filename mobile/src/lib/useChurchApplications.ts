import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ChurchApplication, ChurchCreationPolicy } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/** The signed-in login's church applications, newest first. Asked with or without a church. */
export const useMyChurchApplications = (): UseQueryResult<ChurchApplication[]> => {
  const { user, ready } = useAuth();
  const userId = user?.profile.id;
  return useQuery({
    queryKey: queryKeys.churchApplications(userId),
    queryFn: () => api.myChurchApplications(),
    enabled: ready && Boolean(userId),
  });
};

/**
 * Whether a church may still be created directly. Off by default: until the
 * answer arrives (or if it can't be read) the app offers the application.
 */
export const useChurchCreationPolicy = (): UseQueryResult<ChurchCreationPolicy> => {
  const { user, ready } = useAuth();
  const userId = user?.profile.id;
  return useQuery({
    queryKey: queryKeys.churchCreationPolicy(userId),
    queryFn: () => api.churchCreationPolicy(),
    enabled: ready && Boolean(userId),
    staleTime: 10 * 60_000,
  });
};
