/**
 * Every admin read goes through TanStack Query; every write invalidates the
 * admin data afterwards. Admin routes are platform-wide, so keys carry no
 * organization id, and the whole cache is cleared on sign-out.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AdminChurchApplication,
  AdminCreateChurchRequest,
  AdminOrganizationDetail,
  AdminOrganizationSummary,
  AdminOverview,
  ChurchApplicationStatus,
  OrganizationPlatformControls,
  PlatformAccessGrant,
  PlatformAuditPage,
  PlatformSettings,
  UpdateChurchApplicationRequest,
  UpdatePlatformSettingsInput,
} from '@service-center/shared';
import { api } from '../lib/api';

/** Lines per Activity page. */
export const ACTIVITY_PAGE_SIZE = 50;

export const adminKeys = {
  /** Everything below; invalidated after any write. */
  all: ['admin'] as const,
  overview: () => [...adminKeys.all, 'overview'] as const,
  organizations: () => [...adminKeys.all, 'organizations'] as const,
  organization: (id: string) => [...adminKeys.all, 'organizations', id] as const,
  applications: (status: ChurchApplicationStatus | 'all') => [...adminKeys.all, 'applications', status] as const,
  application: (id: string) => [...adminKeys.all, 'applications', 'one', id] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  activity: (organizationId: string | null, limit: number) =>
    [...adminKeys.all, 'activity', organizationId ?? 'all', limit] as const,
};

/** The admin session lives outside `adminKeys.all` so a write never refetches it. */
export const adminSessionKey = (userId: string) => ['admin-session', userId] as const;

const invalidateAdminData = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: adminKeys.all });

/* -------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------- */

export const useAdminOverview = () =>
  useQuery<AdminOverview>({ queryKey: adminKeys.overview(), queryFn: () => api.adminOverview() });

export const useAdminOrganizations = () =>
  useQuery<AdminOrganizationSummary[]>({ queryKey: adminKeys.organizations(), queryFn: () => api.adminOrganizations() });

export const useAdminOrganization = (id: string) =>
  useQuery<AdminOrganizationDetail>({ queryKey: adminKeys.organization(id), queryFn: () => api.adminOrganization(id) });

/** One status, or every application (newest first) when `status` is `'all'`. */
export const useAdminApplications = (status: ChurchApplicationStatus | 'all') =>
  useQuery<AdminChurchApplication[]>({
    queryKey: adminKeys.applications(status),
    queryFn: () => api.adminChurchApplications(status === 'all' ? undefined : status),
  });

export const useAdminApplication = (id: string) =>
  useQuery({ queryKey: adminKeys.application(id), queryFn: () => api.adminChurchApplication(id), enabled: Boolean(id) });

export const usePlatformSettings = () =>
  useQuery<PlatformSettings>({ queryKey: adminKeys.settings(), queryFn: () => api.adminSettings() });

/** Newest first; `fetchNextPage` loads older lines until `next_before` is null. */
export const useAdminActivity = (organizationId: string | null, limit: number = ACTIVITY_PAGE_SIZE) =>
  useInfiniteQuery<PlatformAuditPage, Error, InfiniteData<PlatformAuditPage, number | null>, readonly unknown[], number | null>({
    queryKey: adminKeys.activity(organizationId, limit),
    queryFn: ({ pageParam }) =>
      api.adminActivity({
        organization_id: organizationId ?? undefined,
        before: pageParam ?? undefined,
        limit,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.next_before,
  });

/* -------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------- */

export interface SetQuotaVariables {
  organizationId: string;
  /** Null returns the church to the platform default. */
  storageQuotaBytes: number | null;
}

export interface DisableOrganizationVariables {
  organizationId: string;
  reason: string;
}

export interface EnterOrganizationVariables {
  organizationId: string;
  hours: number;
}

export interface UpdateApplicationVariables {
  applicationId: string;
  changes: UpdateChurchApplicationRequest;
}

export interface ApproveApplicationVariables {
  applicationId: string;
  slug: string;
}

export interface RejectApplicationVariables {
  applicationId: string;
  reason: string;
}

export const useCreateChurch = () => {
  const queryClient = useQueryClient();
  return useMutation<AdminOrganizationSummary, Error, AdminCreateChurchRequest>({
    mutationFn: (body) => api.adminCreateChurch(body),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useSetOrganizationQuota = () => {
  const queryClient = useQueryClient();
  return useMutation<OrganizationPlatformControls, Error, SetQuotaVariables>({
    mutationFn: ({ organizationId, storageQuotaBytes }) => api.adminSetOrganizationQuota(organizationId, storageQuotaBytes),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useDisableOrganization = () => {
  const queryClient = useQueryClient();
  return useMutation<OrganizationPlatformControls, Error, DisableOrganizationVariables>({
    mutationFn: ({ organizationId, reason }) => api.adminDisableOrganization(organizationId, reason),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useEnableOrganization = () => {
  const queryClient = useQueryClient();
  return useMutation<OrganizationPlatformControls, Error, string>({
    mutationFn: (organizationId) => api.adminEnableOrganization(organizationId),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useEnterOrganization = () => {
  const queryClient = useQueryClient();
  return useMutation<PlatformAccessGrant, Error, EnterOrganizationVariables>({
    mutationFn: ({ organizationId, hours }) => api.adminEnterOrganization(organizationId, { hours }),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useExitOrganization = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (organizationId) => api.adminExitOrganization(organizationId),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useUpdateApplication = () => {
  const queryClient = useQueryClient();
  return useMutation<AdminChurchApplication, Error, UpdateApplicationVariables>({
    mutationFn: ({ applicationId, changes }) => api.adminUpdateChurchApplication(applicationId, changes),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useApproveApplication = () => {
  const queryClient = useQueryClient();
  return useMutation<AdminChurchApplication, Error, ApproveApplicationVariables>({
    mutationFn: ({ applicationId, slug }) => api.adminApproveChurchApplication(applicationId, slug),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useRejectApplication = () => {
  const queryClient = useQueryClient();
  return useMutation<AdminChurchApplication, Error, RejectApplicationVariables>({
    mutationFn: ({ applicationId, reason }) => api.adminRejectChurchApplication(applicationId, reason),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useUpdatePlatformSettings = () => {
  const queryClient = useQueryClient();
  return useMutation<PlatformSettings, Error, UpdatePlatformSettingsInput>({
    mutationFn: (body) => api.adminUpdateSettings(body),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

/** Refetch everything after a 409 that means the data on screen is stale. */
export const useRefreshAdminData = (): (() => Promise<void>) => {
  const queryClient = useQueryClient();
  return () => invalidateAdminData(queryClient);
};
