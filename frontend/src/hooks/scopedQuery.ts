import { hashKey, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useAuth } from '../providers/AuthProvider';

interface PreviousQuery {
  queryKey: QueryKey;
}

interface QueryScope {
  org: string | null;
  authorization: string;
}

interface ScopedQueryOptions {
  queryKey: QueryKey;
  placeholderData: <T>(previous: T | undefined, previousQuery: PreviousQuery | undefined) => T | undefined;
}

export const useQueryScope = (): QueryScope => {
  const { organizationId, session, role, access } = useAuth();
  const accountId = session?.user.id;
  const authorization = useMemo(() => hashKey([accountId, role, access]), [accountId, role, access]);
  return { org: organizationId, authorization };
};

/** Keep old results while a filter changes within the same access and resource scope. */
export const scopedQuery = (queryKey: QueryKey, authorization: string, resource?: QueryKey): ScopedQueryOptions => {
  const org = queryKey[1];
  const scope = hashKey([authorization, resource]);
  return {
    queryKey: [...queryKey, scope] as const,
    placeholderData: <T>(previous: T | undefined, previousQuery: PreviousQuery | undefined): T | undefined =>
      org && previousQuery?.queryKey[1] === org && previousQuery.queryKey.at(-1) === scope ? previous : undefined,
  };
};
