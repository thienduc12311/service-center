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
  AdminUserDeletionResult,
  AdminUserDetail,
  AdminUserSummary,
  InvitePlatformAdminRequest,
  MyPlatformAdminInvitation,
  PlatformAdminInvitation,
  PlatformAdminRoster,
  PlatformUserBlockRow,
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
  activity: (scope: ActivityScope, limit: number) =>
    [...adminKeys.all, 'activity', scope.organizationId ?? 'all', scope.targetUserId ?? 'all', limit] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  user: (id: string) => [...adminKeys.all, 'users', id] as const,
  admins: () => [...adminKeys.all, 'admins'] as const,
};

/** Which Activity lines to read: one church, one account, or (both null) everything. */
export interface ActivityScope {
  organizationId?: string | null;
  targetUserId?: string | null;
}

/** The invitee's own invitation; outside `adminKeys.all` like the session. */
export const myInvitationKey = (userId: string) => ['admin-invitation', userId] as const;

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
export const useAdminActivity = (scope: ActivityScope, limit: number = ACTIVITY_PAGE_SIZE) =>
  useInfiniteQuery<PlatformAuditPage, Error, InfiniteData<PlatformAuditPage, number | null>, readonly unknown[], number | null>({
    queryKey: adminKeys.activity(scope, limit),
    queryFn: ({ pageParam }) =>
      api.adminActivity({
        organization_id: scope.organizationId ?? undefined,
        target_user_id: scope.targetUserId ?? undefined,
        before: pageParam ?? undefined,
        limit,
      }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.next_before,
  });

export const useAdminUsers = () =>
  useQuery<AdminUserSummary[]>({ queryKey: adminKeys.users(), queryFn: () => api.adminUsers() });

export const useAdminUser = (id: string) =>
  useQuery<AdminUserDetail>({ queryKey: adminKeys.user(id), queryFn: () => api.adminUser(id), enabled: Boolean(id) });

export const usePlatformAdmins = () =>
  useQuery<PlatformAdminRoster>({ queryKey: adminKeys.admins(), queryFn: () => api.adminPlatformAdmins() });

/** The signed-in invitee's open invitation (null when there is none). */
export const useMyPlatformAdminInvitation = (userId: string | null, enabled: boolean) =>
  useQuery<MyPlatformAdminInvitation | null>({
    queryKey: myInvitationKey(userId ?? 'signed-out'),
    queryFn: () => api.myPlatformAdminInvitation(),
    enabled: enabled && userId !== null,
    staleTime: Infinity,
    retry: false,
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

export interface BlockUserVariables {
  userId: string;
  reason: string;
}

export interface DeleteUserVariables {
  userId: string;
  confirmEmail: string;
}

export const useBlockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<PlatformUserBlockRow, Error, BlockUserVariables>({
    mutationFn: ({ userId, reason }) => api.adminBlockUser(userId, reason),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useUnblockUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => api.adminUnblockUser(userId),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation<AdminUserDeletionResult, Error, DeleteUserVariables>({
    mutationFn: ({ userId, confirmEmail }) => api.adminDeleteUser(userId, confirmEmail),
    onSuccess: (_result, { userId }) => {
      // The account is gone: don't refetch its page.
      queryClient.removeQueries({ queryKey: adminKeys.user(userId) });
      return invalidateAdminData(queryClient);
    },
  });
};

export const useInvitePlatformAdmin = () => {
  const queryClient = useQueryClient();
  return useMutation<PlatformAdminInvitation, Error, InvitePlatformAdminRequest>({
    mutationFn: (body) => api.adminInvitePlatformAdmin(body),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useRevokePlatformAdminInvitation = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (invitationId) => api.adminRevokePlatformAdminInvitation(invitationId),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

export const useRevokePlatformAdmin = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (userId) => api.adminRevokePlatformAdmin(userId),
    onSuccess: () => invalidateAdminData(queryClient),
  });
};

/** Refetch everything after a 409 that means the data on screen is stale. */
export const useRefreshAdminData = (): (() => Promise<void>) => {
  const queryClient = useQueryClient();
  return () => invalidateAdminData(queryClient);
};
