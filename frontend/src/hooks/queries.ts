import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  conversationAccess,
  flattenConversationPages,
  flattenPeoplePages,
  PEOPLE_PAGE_SIZE,
  CONVERSATION_LIST_POLL_MS,
  CONVERSATION_LIST_TOPIC_LIMIT,
  CONVERSATION_THREAD_POLL_MS,
  LIVE_FALLBACK_POLL_MS,
  REHEARSAL_MANIFEST_TTL_SECONDS,
  type CalendarQueryRequest,
  type ListPlansRequest,
  type FileOwnerKind,
  type ListDeliveriesRequest,
  type ListMediaRequest,
  type ListPlanTemplatesRequest,
  type ListSongsQuery,
  type SongListItem,
  type StaffingMatrixQueryInput,
  type UnreadNotificationCount,
} from '@service-center/shared';
import { api } from '../lib/api';
import { MESSAGES_PAGE_SIZE, nextMessagesCursor } from '../lib/message-paging';
import { useAuth } from '../providers/AuthProvider';
import { useBroadcastRefresh } from './useBroadcastRefresh';

/**
 * Every key is namespaced by organization so switching orgs can never surface
 * another tenant's cached data.
 */
export const keys = {
  all: (org: string | null) => ['org', org] as const,
  organizationStorage: (org: string | null) => [...keys.all(org), 'organization-storage'] as const,
  people: (org: string | null) => [...keys.all(org), 'people'] as const,
  person: (org: string | null, id: string) => [...keys.people(org), id] as const,
  teams: (org: string | null) => [...keys.all(org), 'teams'] as const,
  serviceTypes: (org: string | null) => [...keys.all(org), 'service-types'] as const,
  songs: (org: string | null, query: unknown) => [...keys.all(org), 'songs', query] as const,
  song: (org: string | null, id: string) => [...keys.all(org), 'song', id] as const,
  songSchedule: (org: string | null, id: string, query: unknown) =>
    [...keys.song(org, id), 'schedule', query] as const,
  plans: (org: string | null, query: unknown) => [...keys.all(org), 'plans', query] as const,
  plan: (org: string | null, id: string) => [...keys.all(org), 'plan', id] as const,
  calendar: (org: string | null, query: unknown) => [...keys.all(org), 'calendar', query] as const,
  mySchedule: (org: string | null, query: unknown) => [...keys.all(org), 'my-schedule', query] as const,
  blockouts: (org: string | null, query: unknown) => [...keys.all(org), 'blockouts', query] as const,
  calendarFeed: (org: string | null) => [...keys.all(org), 'calendar-feed'] as const,
  /** People this account blocked (per person; under the org root so a sign-out clears it). */
  blockedUsers: (org: string | null) => [...keys.all(org), 'blocked-users'] as const,
  /** What deleting the account would do. Per login: it must work before joining any organization. */
  accountDeletionPlan: (userId: string | null) => ['account', userId, 'deletion-plan'] as const,
  deliveryStatus: (org: string | null) => [...keys.all(org), 'delivery-status'] as const,
  deliveries: (org: string | null, query: unknown) => [...keys.all(org), 'deliveries', query] as const,
  // F17 developer API and webhooks.
  integrations: (org: string | null) => [...keys.all(org), 'integrations'] as const,
  integrationStatus: (org: string | null) => [...keys.integrations(org), 'status'] as const,
  apiCredentials: (org: string | null) => [...keys.integrations(org), 'credentials'] as const,
  webhookEndpoints: (org: string | null) => [...keys.integrations(org), 'webhooks'] as const,
  webhookDeliveries: (org: string | null, endpointId: string) => [...keys.integrations(org), 'webhooks', endpointId, 'deliveries'] as const,
  // F08 release and reminders.
  preparedRequests: (org: string | null) => [...keys.all(org), 'releases', 'prepared'] as const,
  releaseBatches: (org: string | null) => [...keys.all(org), 'releases', 'batches'] as const,
  reminderPolicies: (org: string | null, serviceTypeId: string | null, teamId: string | null) =>
    [...keys.all(org), 'reminder-policies', serviceTypeId, teamId] as const,
  myReminderPreferences: (org: string | null) => [...keys.all(org), 'reminder-preferences', 'me'] as const,
  planDeliveries: (org: string | null, planId: string) => [...keys.plan(org, planId), 'deliveries'] as const,
  accessMembers: (org: string | null) => [...keys.all(org), 'access', 'members'] as const,
  scopeAccess: (org: string | null, scope: string, id: string | null) =>
    [...keys.all(org), 'access', 'scope', scope, id] as const,
  folders: (org: string | null) => [...keys.all(org), 'folders'] as const,
  songbooks: (org: string | null) => [...keys.all(org), 'songbooks'] as const,
  songbook: (org: string | null, id: string) => [...keys.songbooks(org), id] as const,
  /** Includes archived people (F02); a separate entry from the default list. */
  /** The People list screen's keyset pages; under `people`, so any roster invalidation refreshes it. */
  peoplePage: (org: string | null, filters: PeoplePageFilters) => [...keys.people(org), 'page', filters] as const,
  deliveryReadiness: (org: string | null, ids: readonly string[]) =>
    [...keys.people(org), { readiness: [...ids].sort() }] as const,
  rosterAudit: (org: string | null, personId: string | null) => [...keys.all(org), 'roster-audit', personId] as const,
  tagCatalog: (org: string | null) => [...keys.all(org), 'tag-catalog'] as const,
  reconciliations: (org: string | null) => [...keys.all(org), 'reconciliations'] as const,
  /** Owners: people asking to join the active church. */
  joinRequests: (org: string | null) => [...keys.all(org), 'join-requests'] as const,
  search: (org: string | null, q: string) => [...keys.all(org), 'search', q] as const,
  // F03 availability. Person-scoped keys include the person, so a delegate's
  // view of someone else never shares a cache entry with their own.
  schedulingPreferences: (org: string | null, personId: string | null) =>
    [...keys.all(org), 'scheduling-preferences', personId] as const,
  availabilityReview: (org: string | null, personId: string | null) =>
    [...keys.all(org), 'availability-review', personId] as const,
  myAvailabilityRequests: (org: string | null) => [...keys.all(org), 'availability-requests', 'mine'] as const,
  availabilityRequests: (org: string | null, teamId: string | null) =>
    [...keys.all(org), 'availability-requests', 'team', teamId] as const,
  availabilityRequest: (org: string | null, id: string) => [...keys.all(org), 'availability-requests', 'detail', id] as const,
  delegations: (org: string | null) => [...keys.all(org), 'delegations'] as const,
  delegatedSchedule: (org: string | null, id: string) => [...keys.delegations(org), id, 'schedule'] as const,
  preferenceWarnings: (org: string | null, query: unknown) => [...keys.all(org), 'preference-warnings', query] as const,
  // F04 attendance and conflicts.
  conflictCheck: (org: string | null, query: unknown) => [...keys.all(org), 'conflict-check', query] as const,
  conflictOverrides: (org: string | null, planId: string) => [...keys.plan(org, planId), 'conflict-overrides'] as const,
  staffingMatrix: (org: string | null, input: unknown) => [...keys.all(org), 'staffing-matrix', input] as const,
  staffingMatrixViews: (org: string | null) => [...keys.all(org), 'staffing-matrix-views'] as const,
  staffingProposals: (org: string | null) => [...keys.all(org), 'staffing-proposals'] as const,
  rotations: (org: string | null, teamId: string) => [...keys.all(org), 'rotations', teamId] as const,
  // F09 collaboration.
  planNotes: (org: string | null, planId: string) => [...keys.plan(org, planId), 'notes'] as const,
  itemComments: (org: string | null, itemId: string) => [...keys.all(org), 'item-comments', itemId] as const,
  mentionCandidates: (org: string | null, target: string) => [...keys.all(org), 'mention-candidates', target] as const,
  messages: (org: string | null, query: unknown) => [...keys.all(org), 'messages', query] as const,
  message: (org: string | null, id: string) => [...keys.all(org), 'messages', 'detail', id] as const,
  messageTemplates: (org: string | null) => [...keys.all(org), 'message-templates'] as const,
  // F10 plan templates.
  planTemplates: (org: string | null, query: unknown) => [...keys.all(org), 'plan-templates', query] as const,
  planTemplate: (org: string | null, id: string, revision: number | null) =>
    [...keys.all(org), 'plan-templates', 'detail', id, revision] as const,
  templateApplications: (org: string | null, planId: string) => [...keys.plan(org, planId), 'template-applications'] as const,
  conversations: (org: string | null) => [...keys.all(org), 'conversations'] as const,
  notifications: (org: string | null) => [...keys.all(org), 'notifications'] as const,
  notificationFeed: (org: string | null) => [...keys.notifications(org), 'feed'] as const,
  notificationUnread: (org: string | null) => [...keys.notifications(org), 'unread'] as const,
  conversation: (org: string | null, id: string) => [...keys.conversations(org), id] as const,
  // F16 attendance, reports, calendar extension and publication.
  attendance: (org: string | null, planId: string, timeId: string | null) =>
    [...keys.plan(org, planId), 'attendance', timeId] as const,
  attendanceHistory: (org: string | null, planId: string, timeId: string, personId: string) =>
    [...keys.plan(org, planId), 'attendance-history', timeId, personId] as const,
  report: (org: string | null, kind: string, filters: unknown) => [...keys.all(org), 'reports', kind, filters] as const,
  reportExports: (org: string | null) => [...keys.all(org), 'reports', 'exports'] as const,
  scopedFeeds: (org: string | null) => [...keys.all(org), 'calendar-feeds'] as const,
  calendarLayers: (org: string | null, query: unknown) => [...keys.all(org), 'calendar-layers', query] as const,
  publication: (org: string | null, planId: string) => [...keys.plan(org, planId), 'publication'] as const,
  publicLinks: (org: string | null, serviceTypeId: string) => [...keys.all(org), 'public-links', serviceTypeId] as const,
  personSharing: (org: string | null, personId: string) => [...keys.person(org, personId), 'calendar-sharing'] as const,
  // F12 Live.
  liveRuns: (org: string | null, planId: string) => [...keys.plan(org, planId), 'live-runs'] as const,
  liveRun: (org: string | null, runId: string) => [...keys.all(org), 'live-run', runId] as const,
  liveRunHistory: (org: string | null, runId: string) => [...keys.all(org), 'live-run-history', runId] as const,
  // F13 files. Every file key sits under `files` so one invalidation refreshes them all.
  files: (org: string | null) => [...keys.all(org), 'files'] as const,
  parentFiles: (org: string | null, ownerKind: string, ownerId: string) => [...keys.files(org), 'parent', ownerKind, ownerId] as const,
  planFiles: (org: string | null, planId: string) => [...keys.files(org), 'plan', planId] as const,
  file: (org: string | null, fileId: string) => [...keys.files(org), 'detail', fileId] as const,
  fileDocument: (org: string | null, fileId: string, versionId: string | null) =>
    [...keys.files(org), 'document', fileId, versionId] as const,
  // F14: the manifest sits under `files`, so any file change refreshes it too.
  rehearsal: (org: string | null, planId: string) => [...keys.files(org), 'rehearsal', planId] as const,
  media: (org: string | null) => [...keys.all(org), 'media'] as const,
  mediaList: (org: string | null, query: unknown) => [...keys.media(org), 'list', query] as const,
  mediaDetail: (org: string | null, id: string) => [...keys.media(org), 'detail', id] as const,
  stageTemplates: (org: string | null) => [...keys.all(org), 'stage-templates'] as const,
  stageLayouts: (org: string | null, planId: string) => [...keys.plan(org, planId), 'stage-layouts'] as const,
};

/** Not organization-scoped: the signed-in user's own cross-organization settings. */
export const userKeys = {
  scheduleSettings: (userId: string | null) => ['user', userId, 'schedule-settings'] as const,
  combinedSchedule: (userId: string | null, query: unknown) => ['user', userId, 'combined-schedule', query] as const,
};

const useOrg = () => useAuth().organizationId;

type Options<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>;

export const usePeople = (options?: Options<Awaited<ReturnType<typeof api.listPeople>>>) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.people(org),
    queryFn: () => api.listPeople(),
    enabled: Boolean(org),
    ...options,
  });
};

export const usePerson = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.person(org, id ?? ''),
    queryFn: () => api.getPerson(id!),
    enabled: Boolean(org && id),
  });
};

export const useTeams = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.teams(org), queryFn: () => api.listTeams(), enabled: Boolean(org) });
};

export const useServiceTypes = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.serviceTypes(org),
    queryFn: () => api.listServiceTypes(),
    enabled: Boolean(org),
  });
};

export const useSongs = (query: { q?: string; sort?: string; page?: number; per_page?: number }) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songs(org, query),
    queryFn: () => api.listSongs(query),
    enabled: Boolean(org),
    placeholderData: (previous) => previous,
  });
};

/**
 * Every page of a song list, loaded on demand ("Show more"); the song
 * browser's source. Earlier results stay on screen while a new search loads.
 */
export const useSongPages = (query: Omit<Partial<ListSongsQuery>, 'page'>, enabled = true) => {
  const org = useOrg();
  const pages = useInfiniteQuery({
    queryKey: [...keys.songs(org, query), 'pages'] as const,
    queryFn: ({ pageParam }) => api.listSongs({ ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
    enabled: Boolean(org) && enabled,
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => {
    // A song can shift between pages while paging (new usage); list it once.
    const seen = new Set<string>();
    const unique: SongListItem[] = [];
    for (const song of (pages.data?.pages ?? []).flatMap((page) => page.data)) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      unique.push(song);
    }
    return unique;
  }, [pages.data]);
  return { ...pages, rows, total: pages.data?.pages[0]?.total ?? null };
};

export const useSong = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.song(org, id ?? ''),
    queryFn: () => api.getSong(id!),
    enabled: Boolean(org && id),
  });
};

/** The services a song was scheduled in — the song page's Schedule panel. */
export const useSongSchedule = (
  id: string | undefined,
  query: { limit: number; arrangement_id?: string },
) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songSchedule(org, id ?? '', query),
    queryFn: () => api.getSongSchedule(id!, query),
    enabled: Boolean(org && id),
    placeholderData: (previous) => previous,
  });
};

export const usePlans = (query: Record<string, string | number | undefined>, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.plans(org, query),
    queryFn: () => api.listPlans(query),
    enabled: Boolean(org) && enabled,
    placeholderData: (previous) => previous,
  });
};

/**
 * Every page of a plan list, loaded on demand ("Show more"). Pages are
 * fetched with the same query, so later pages extend earlier ones and plans
 * beyond the first page stay reachable (W2-PLANS-D10).
 */
export const usePlanPages = (query: Omit<ListPlansRequest, 'page'>, enabled = true) => {
  const org = useOrg();
  return useInfiniteQuery({
    queryKey: [...keys.plans(org, query), 'pages'] as const,
    queryFn: ({ pageParam }) => api.listPlans({ ...query, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
    enabled: Boolean(org) && enabled,
    // A new search keeps the last results on screen until its first page arrives.
    placeholderData: (previous) => previous,
  });
};

export const usePlan = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.plan(org, id ?? ''),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(org && id),
  });
};

export const useStaffingMatrix = (input: StaffingMatrixQueryInput, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.staffingMatrix(org, input),
    queryFn: () => api.staffingMatrix(input),
    enabled: Boolean(org) && enabled,
    placeholderData: (previous) => previous,
  });
};

export const useStaffingProposals = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.staffingProposals(org), queryFn: () => api.staffingProposals(), enabled: Boolean(org) });
};

export const useRotations = (teamId: string) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.rotations(org, teamId),
    queryFn: () => api.rotations({ team_id: teamId }),
    enabled: Boolean(org && teamId),
  });
};

export const useStaffingMatrixViews = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.staffingMatrixViews(org), queryFn: () => api.staffingMatrixViews(), enabled: Boolean(org) });
};

export const useCalendar = (query: CalendarQueryRequest) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.calendar(org, query),
    queryFn: () => api.calendar(query),
    enabled: Boolean(org),
    placeholderData: (previous) => previous,
  });
};

export const useMySchedule = (query: { include_past?: boolean; status?: string } = {}) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.mySchedule(org, query),
    queryFn: () => api.mySchedule(query),
    enabled: Boolean(org),
  });
};

export const useBlockouts = (query: { scope?: 'mine' | 'organization'; person_id?: string } = {}) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.blockouts(org, query),
    queryFn: () => api.listBlockouts(query),
    enabled: Boolean(org),
  });
};

export const useCalendarFeed = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.calendarFeed(org), queryFn: () => api.getCalendarFeed(), enabled: Boolean(org) });
};

export const useDeliveryStatus = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.deliveryStatus(org), queryFn: () => api.deliveryStatus(), enabled: Boolean(org) });
};

export const useDeliveries = (query: ListDeliveriesRequest) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.deliveries(org, query),
    queryFn: () => api.listDeliveries(query),
    enabled: Boolean(org),
  });
};

// ------------------------------------------- F17 developer API and webhooks

export const useIntegrationStatus = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.integrationStatus(org), queryFn: () => api.integrationStatus(), enabled: Boolean(org) });
};

export const useApiCredentials = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.apiCredentials(org), queryFn: () => api.apiCredentials(), enabled: Boolean(org) });
};

export const useWebhookEndpoints = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.webhookEndpoints(org),
    queryFn: () => api.webhookEndpoints(),
    enabled: Boolean(org),
    // Waiting counts settle as the worker sends; refresh until they do.
    refetchInterval: (query) => (query.state.data?.some((endpoint) => endpoint.pending_deliveries > 0) ? 10_000 : false),
  });
};

/** Polls while a delivery is still waiting so outcomes appear without a reload. */
export const useWebhookDeliveries = (endpointId: string, enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.webhookDeliveries(org, endpointId),
    queryFn: () => api.webhookDeliveries(endpointId),
    enabled: Boolean(org) && enabled,
    refetchInterval: (query) =>
      query.state.data?.some((delivery) => delivery.status === 'queued' || delivery.status === 'sending') ? 5_000 : false,
  });
};

export const useInvalidateIntegrations = () => {
  const org = useOrg();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: keys.integrations(org) });
};

// ---------------------------------------------------- F08 release/reminders

export const usePreparedRequests = (enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.preparedRequests(org),
    queryFn: () => api.listPreparedRequests(),
    enabled: Boolean(org) && enabled,
  });
};

export const useReleaseBatches = (enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.releaseBatches(org),
    queryFn: () => api.listReleaseBatches(),
    enabled: Boolean(org) && enabled,
  });
};

export const useReminderPolicies = (scope: { serviceTypeId?: string | null; teamId?: string | null }, enabled = true) => {
  const org = useOrg();
  const serviceTypeId = scope.serviceTypeId ?? null;
  const teamId = scope.teamId ?? null;
  return useQuery({
    queryKey: keys.reminderPolicies(org, serviceTypeId, teamId),
    queryFn: () => api.reminderPolicies({
      ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
      ...(teamId ? { team_id: teamId } : {}),
    }),
    enabled: Boolean(org) && enabled,
  });
};

export const useMyReminderPreferences = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.myReminderPreferences(org),
    queryFn: () => api.myReminderPreferences(),
    enabled: Boolean(org),
  });
};

export const usePlanDeliveries = (planId: string, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.planDeliveries(org, planId),
    queryFn: () => api.planDeliveryHistory(planId),
    enabled: Boolean(org) && enabled,
  });
};

export const useSongbooks = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songbooks(org),
    queryFn: () => api.listSongbooks(),
    enabled: Boolean(org),
  });
};

export const useSongbook = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songbook(org, id ?? ''),
    queryFn: () => api.getSongbook(id!),
    enabled: Boolean(org && id),
    // document_url is signed for SONGBOOK_DOCUMENT_URL_TTL_SECONDS; never
    // hand a cached (possibly expired) one to the viewer on return.
    gcTime: 0,
  });
};

/** Invalidates everything under the active organization. */
export const useInvalidateOrg = () => {
  const org = useOrg();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: keys.all(org) });
};

export const useRespondToAssignment = () => {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(id, { status }),
    onSuccess: invalidate,
  });
};

export const useAccessMembers = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.accessMembers(org), queryFn: () => api.listAccessMembers(), enabled: Boolean(org) });
};

export const useFolderTree = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.folders(org), queryFn: () => api.folderTree(), enabled: Boolean(org) });
};

// ------------------------------------------------------------------ F02 --

/** Filters the People list sends to the server (W8 paging: search and archive moved server-side). */
export interface PeoplePageFilters {
  q: string;
  includeArchived: boolean;
  /** Only members of this team; '' or absent is everyone. */
  teamId?: string;
}

/** How a people page list is fetched, beyond its filters. */
export interface PeoplePageOptions {
  enabled?: boolean;
}

/**
 * The People list, 25 at a time. `data` is every page loaded so far; call
 * `fetchNextPage` while `hasNextPage`. `total` is every match on the server
 * (null until the first page arrives). Pickers that need the whole roster
 * keep using `usePeople`.
 */
export const usePeoplePage = (filters: PeoplePageFilters, options: PeoplePageOptions = {}) => {
  const org = useOrg();
  const query = useInfiniteQuery({
    queryKey: keys.peoplePage(org, filters),
    queryFn: ({ pageParam }) =>
      api.listPeoplePage({
        limit: PEOPLE_PAGE_SIZE,
        cursor: pageParam,
        ...(filters.q ? { q: filters.q } : {}),
        ...(filters.teamId ? { team_id: filters.teamId } : {}),
        ...(filters.includeArchived ? { include_archived: true } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(org) && (options.enabled ?? true),
    // Keep the last results on screen while a new search loads, instead of a skeleton per keystroke.
    placeholderData: (previous) => previous,
  });
  return {
    ...query,
    data: query.data ? flattenPeoplePages(query.data.pages) : undefined,
    total: query.data?.pages[0]?.total ?? null,
  };
};

/** Whether requests can reach these People (login, email, active) — never the address. */
export const useDeliveryReadiness = (personIds: readonly string[]) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.deliveryReadiness(org, personIds),
    queryFn: () => api.deliveryReadiness({ person_ids: [...personIds] }),
    enabled: Boolean(org) && personIds.length > 0,
  });
};

/** Roster events per request by default, and the most the endpoint returns (it has no cursor). */
export const ROSTER_AUDIT_PAGE = 50;
export const ROSTER_AUDIT_MAX = 200;

export const useRosterAudit = (personId: string | null, enabled = true, limit: number = ROSTER_AUDIT_PAGE) => {
  const org = useOrg();
  return useQuery({
    queryKey: [...keys.rosterAudit(org, personId), limit] as const,
    queryFn: () => api.rosterAudit({ ...(personId ? { person_id: personId } : {}), limit }),
    enabled: Boolean(org) && enabled,
    // Raising the limit keeps the shorter list on screen until the longer one arrives.
    placeholderData: (previous) => previous,
  });
};

export const useTagCatalog = (enabled = true) => {
  const org = useOrg();
  return useQuery({ queryKey: keys.tagCatalog(org), queryFn: () => api.rosterTagCatalog(), enabled: Boolean(org) && enabled });
};

export const useIdentityReconciliations = (enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.reconciliations(org),
    queryFn: () => api.identityReconciliations(),
    enabled: Boolean(org) && enabled,
  });
};

/** Global search; runs once the query has two characters. */
export const useGlobalSearch = (q: string) => {
  const org = useOrg();
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(org, query),
    queryFn: () => api.search({ q: query, limit: 5 }),
    enabled: Boolean(org) && query.length >= 2,
    staleTime: 30_000,
  });
};

// ------------------------------------------------------------ F03 --------

export const useSchedulingPreferences = (personId?: string) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.schedulingPreferences(org, personId ?? null),
    queryFn: () => api.listSchedulingPreferences(personId ? { person_id: personId } : undefined),
    enabled: Boolean(org),
  });
};

export const useAvailabilityReview = (personId?: string) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.availabilityReview(org, personId ?? null),
    queryFn: () => api.availabilityReview(personId ? { person_id: personId } : undefined),
    enabled: Boolean(org),
  });
};

export const useMyAvailabilityRequests = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.myAvailabilityRequests(org), queryFn: () => api.myAvailabilityRequests(), enabled: Boolean(org) });
};

export const useAvailabilityRequests = (teamId: string | null, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.availabilityRequests(org, teamId),
    queryFn: () => api.listAvailabilityRequests(teamId ? { team_id: teamId } : undefined),
    enabled: Boolean(org) && enabled,
  });
};

export const useAvailabilityRequest = (id: string | null) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.availabilityRequest(org, id ?? ''),
    queryFn: () => api.getAvailabilityRequest(id!),
    enabled: Boolean(org && id),
  });
};

export const useDelegations = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.delegations(org), queryFn: () => api.listDelegations(), enabled: Boolean(org) });
};

export const useDelegatedSchedule = (id: string | undefined, enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.delegatedSchedule(org, id ?? ''),
    queryFn: () => api.delegatedSchedule(id!),
    enabled: Boolean(org && id) && enabled,
  });
};

export const useScheduleSettings = () => {
  const userId = useAuth().user?.profile.id ?? null;
  return useQuery({
    queryKey: userKeys.scheduleSettings(userId),
    queryFn: () => api.scheduleSettings(),
    enabled: Boolean(userId),
  });
};

export const useCombinedSchedule = (query: { from: string; to: string }, enabled: boolean) => {
  const userId = useAuth().user?.profile.id ?? null;
  return useQuery({
    queryKey: userKeys.combinedSchedule(userId, query),
    queryFn: () => api.combinedSchedule(query),
    enabled: Boolean(userId) && enabled,
  });
};

// ------------------------------------------------------------------ F09 ----

export const usePlanNotes = (planId: string) => {
  const org = useOrg();
  return useQuery({ queryKey: keys.planNotes(org, planId), queryFn: () => api.planNotes(planId), enabled: Boolean(org && planId) });
};

export const useItemComments = (itemId: string | null) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.itemComments(org, itemId ?? ''),
    queryFn: () => api.itemComments(itemId!, { limit: 50 }),
    enabled: Boolean(org && itemId),
    retry: false,
  });
};

export const useMentionCandidates = (target: { plan_id: string } | { conversation_id: string } | null) => {
  const org = useOrg();
  const id = target ? ('plan_id' in target ? `plan:${target.plan_id}` : `conversation:${target.conversation_id}`) : '';
  return useQuery({
    queryKey: keys.mentionCandidates(org, id),
    queryFn: () => api.mentionCandidates(target!),
    enabled: Boolean(org && target),
    retry: false,
  });
};

/** Which operational messages a list shows. */
export interface MessageListFilters {
  box: 'sent' | 'received';
  plan_id?: string;
}

/**
 * Operational messages, newest first, `MESSAGES_PAGE_SIZE` at a time.
 * `fetchNextPage` reads the page before the oldest loaded message.
 */
export const useMessagePages = (query: MessageListFilters) => {
  const org = useOrg();
  return useInfiniteQuery({
    queryKey: [...keys.messages(org, query), 'pages'] as const,
    queryFn: ({ pageParam }) =>
      api.listMessages({ ...query, limit: MESSAGES_PAGE_SIZE, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => nextMessagesCursor(last),
    enabled: Boolean(org),
  });
};

export const useMessage = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.message(org, id ?? ''),
    queryFn: () => api.getMessage(id!),
    enabled: Boolean(org && id),
    retry: false,
  });
};

export const useMessageTemplates = (enabled = true) => {
  const org = useOrg();
  return useQuery({ queryKey: keys.messageTemplates(org), queryFn: () => api.messageTemplates(), enabled: Boolean(org) && enabled });
};

/**
 * Known conversations each have their own authorization; polling also
 * discovers new ones. Keyset-paged (W8-PERF-D3): `data` is every page loaded
 * so far, and `fetchNextPage` keeps going until `hasNextPage` is false.
 */
export const useConversations = (visible: boolean) => {
  const org = useOrg();
  const queryKey = [...keys.conversations(org), 'pages'] as const;
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api.conversationsPage({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: Boolean(org && visible),
    staleTime: 0,
    refetchInterval: CONVERSATION_LIST_POLL_MS,
    refetchOnWindowFocus: 'always',
  });
  const loaded = query.data ? flattenConversationPages(query.data.pages) : undefined;
  const data = conversationAccess(query.error) === 'unavailable' ? undefined : loaded;
  useBroadcastRefresh('conversation', visible ? data?.slice(0, CONVERSATION_LIST_TOPIC_LIMIT).map((conversation) => conversation.id) ?? [] : [], { queryKey, exact: true });
  return { ...query, data };
};

export const useConversation = (id: string | undefined) => {
  const org = useOrg();
  const queryKey = keys.conversation(org, id ?? '');
  const query = useQuery({
    queryKey,
    queryFn: () => api.getConversation(id!),
    enabled: Boolean(org && id),
    refetchInterval: CONVERSATION_THREAD_POLL_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  useBroadcastRefresh('conversation', id && conversationAccess(query.error) !== 'unavailable' ? [id] : [], { queryKey });
  return query;
};

/** F10: templates the caller may use; RLS narrows them to their plans.edit scope. */
export const usePlanTemplates = (query: ListPlanTemplatesRequest, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.planTemplates(org, query),
    queryFn: () => api.planTemplates(query),
    enabled: Boolean(org) && enabled,
  });
};

export const usePlanTemplate = (id: string | null, revision: number | null = null) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.planTemplate(org, id ?? '', revision),
    queryFn: () => api.planTemplate(id!, revision ?? undefined),
    enabled: Boolean(org && id),
  });
};

export const useTemplateApplications = (planId: string | undefined, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.templateApplications(org, planId ?? ''),
    queryFn: () => api.planTemplateApplications(planId!),
    enabled: Boolean(org && planId) && enabled,
  });
};

// ------------------------------------------------------------------ F12 --

/** A plan topic discovers runs created while the service-time picker is open. */
export const useLivePlanRuns = (planId: string | undefined) => {
  const org = useOrg();
  const queryKey = keys.liveRuns(org, planId ?? '');
  useBroadcastRefresh('live_plan', planId ? [planId] : [], { queryKey, exact: true });
  return useQuery({
    queryKey,
    queryFn: () => api.liveRuns(planId!),
    enabled: Boolean(org && planId),
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: 'always',
  });
};

/** History, corrections and planned-versus-actual for one run. */
export const useLiveRunHistory = (runId: string | null, enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.liveRunHistory(org, runId ?? ''),
    queryFn: () => api.liveRunHistory(runId!),
    enabled: Boolean(org && runId && enabled),
  });
};

// ------------------------------------------------------------------ F13 --

export const useParentFiles = (ownerKind: FileOwnerKind, ownerId: string | null | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.parentFiles(org, ownerKind, ownerId ?? ''),
    queryFn: () => api.files(ownerKind, ownerId!),
    enabled: Boolean(org && ownerId),
  });
};

export const usePlanFiles = (planId: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.planFiles(org, planId ?? ''),
    queryFn: () => api.planFiles(planId!),
    enabled: Boolean(org && planId),
  });
};

export const useFileDetail = (fileId: string | null) => {
  const org = useOrg();
  return useQuery({ queryKey: keys.file(org, fileId ?? ''), queryFn: () => api.file(fileId!), enabled: Boolean(org && fileId) });
};

export const useFileDocument = (fileId: string | null, versionId: string | null) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.fileDocument(org, fileId ?? '', versionId),
    queryFn: () => api.fileDocument(fileId!, versionId ?? undefined),
    enabled: Boolean(org && fileId),
  });
};

/** Refreshes every file list after a change (a file can appear under several parents). */
export const useInvalidateFiles = () => {
  const org = useOrg();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: keys.files(org) });
};

// ------------------------------------------------------------------ F14 --

/**
 * The plan's rehearsal manifest. It names versions, not URLs, and is re-read
 * when it expires (rights and versions are rechecked on every read).
 */
export const useRehearsalManifest = (planId: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.rehearsal(org, planId ?? ''),
    queryFn: () => api.rehearsalManifest(planId!),
    enabled: Boolean(org && planId),
    staleTime: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
    refetchInterval: REHEARSAL_MANIFEST_TTL_SECONDS * 1000,
  });
};

export const useMediaList = (query: ListMediaRequest) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.mediaList(org, query),
    queryFn: () => api.mediaList(query),
    enabled: Boolean(org),
    // Keep the last results on screen while a new search loads.
    placeholderData: (previous) => previous,
  });
};

export const useMediaDetail = (mediaId: string | null | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.mediaDetail(org, mediaId ?? ''),
    queryFn: () => api.media(mediaId!),
    enabled: Boolean(org && mediaId),
  });
};

export const useInvalidateMedia = () => {
  const org = useOrg();
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.media(org) }),
      client.invalidateQueries({ queryKey: keys.files(org) }),
    ]);
};

export const useStageTemplates = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.stageTemplates(org), queryFn: () => api.stageTemplates(), enabled: Boolean(org) });
};

export const usePlanStageLayouts = (planId: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.stageLayouts(org, planId ?? ''),
    queryFn: () => api.planStageLayouts(planId!),
    enabled: Boolean(org && planId),
  });
};

// ---------------------------------------------------- church applications --

/**
 * The caller's own church applications and whether churches can be created
 * without one. Not tied to a church: an applicant usually has none yet.
 */
export const accountKeys = {
  churchApplications: ['account', 'church-applications'] as const,
  /** The caller's requests to join churches (asked before belonging to any). */
  churchJoinRequests: ['account', 'church-join-requests'] as const,
  churchCreationPolicy: ['account', 'church-creation-policy'] as const,
};

export const useChurchCreationPolicy = () =>
  useQuery({ queryKey: accountKeys.churchCreationPolicy, queryFn: () => api.churchCreationPolicy() });

/** Newest first. */
export const useMyChurchApplications = () =>
  useQuery({ queryKey: accountKeys.churchApplications, queryFn: () => api.myChurchApplications() });

/** Newest first. */
export const useMyChurchJoinRequests = () =>
  useQuery({ queryKey: accountKeys.churchJoinRequests, queryFn: () => api.myChurchJoinRequests() });

/** Owners only: the active church's pending and recently decided join requests. */
export const useChurchJoinRequests = (enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.joinRequests(org),
    queryFn: () => api.churchJoinRequests(),
    enabled: enabled && Boolean(org),
  });
};

/**
 * The active church's media use against its quota. Only owners and admins
 * ask: they are the ones who can free up space.
 */
export const useOrganizationStorage = (enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.organizationStorage(org),
    queryFn: () => api.organizationStorage(),
    enabled: Boolean(org) && enabled,
    staleTime: 5 * 60_000,
  });
};

/* ------------------------------------------------------------ notifications */

/** How often the bell re-checks the unread count; matches the mobile app. */
export const NOTIFICATION_POLL_MS = 60_000;
const NOTIFICATION_PAGE_SIZE = 30;

/** The bell's unread count: polled, and refreshed whenever the tab regains focus. */
export const useUnreadNotificationCount = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.notificationUnread(org),
    queryFn: () => api.unreadNotificationCount(),
    enabled: Boolean(org),
    refetchInterval: NOTIFICATION_POLL_MS,
    refetchOnWindowFocus: 'always',
  });
};

/** The notification feed, newest first, paged backwards in time. `unreadOnly` asks the server for unread rows only. */
export const useNotificationFeed = (unreadOnly = false) => {
  const org = useOrg();
  return useInfiniteQuery({
    queryKey: unreadOnly ? [...keys.notificationFeed(org), 'unread-only'] : keys.notificationFeed(org),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.listNotifications({ limit: NOTIFICATION_PAGE_SIZE, before: pageParam, ...(unreadOnly ? { unread_only: true } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(org),
  });
};

/** Writes fresh counts straight into the bell, then refetches the feed. */
const useSettleNotifications = () => {
  const org = useOrg();
  const queryClient = useQueryClient();
  return async (counts?: UnreadNotificationCount): Promise<void> => {
    if (counts) queryClient.setQueryData(keys.notificationUnread(org), counts);
    await queryClient.invalidateQueries({ queryKey: keys.notifications(org) });
  };
};

/** Omit `ids` to mark the whole feed read. */
export const useMarkNotificationsRead = () => {
  const settle = useSettleNotifications();
  return useMutation({
    mutationFn: (ids?: string[]) => api.markNotificationsRead(ids ? { ids } : {}),
    onSuccess: (counts) => settle(counts),
  });
};

export const useDeleteNotification = () => {
  const settle = useSettleNotifications();
  return useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onSettled: () => settle(),
  });
};

export const useClearReadNotifications = () => {
  const settle = useSettleNotifications();
  return useMutation({
    mutationFn: () => api.clearReadNotifications(),
    onSuccess: ({ unread, account_unread }) => settle({ unread, account_unread }),
  });
};
