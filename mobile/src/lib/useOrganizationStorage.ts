import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { OrganizationStorageUsage } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/**
 * The active church's media usage. Only owners and admins can act on it, so
 * nobody else asks; keyed by account, church and generation like every
 * church read.
 */
export const useOrganizationStorage = (): UseQueryResult<OrganizationStorageUsage> => {
  const { queryScope, isAdmin } = useAuth();
  return useQuery({
    queryKey: queryKeys.organizationStorage(queryScope),
    queryFn: () => api.organizationStorage(),
    enabled: Boolean(queryScope) && isAdmin,
    staleTime: 5 * 60_000,
  });
};
