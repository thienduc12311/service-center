import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { ListDeliveriesRequest, ListPlanTemplatesRequest, StaffingMatrixQueryInput } from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

/**
 * Every key is namespaced by organization so switching orgs can never surface
 * another tenant's cached data.
 */
export const keys = {
  all: (org: string | null) => ['org', org] as const,
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
  deliveryStatus: (org: string | null) => [...keys.all(org), 'delivery-status'] as const,
  deliveries: (org: string | null, query: unknown) => [...keys.all(org), 'deliveries', query] as const,
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
  peopleWithArchived: (org: string | null) => [...keys.people(org), { archived: true }] as const,
  deliveryReadiness: (org: string | null, ids: readonly string[]) =>
    [...keys.people(org), { readiness: [...ids].sort() }] as const,
  rosterAudit: (org: string | null, personId: string | null) => [...keys.all(org), 'roster-audit', personId] as const,
  tagCatalog: (org: string | null) => [...keys.all(org), 'tag-catalog'] as const,
  reconciliations: (org: string | null) => [...keys.all(org), 'reconciliations'] as const,
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
  conversation: (org: string | null, id: string) => [...keys.conversations(org), id] as const,
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

export const usePlans = (query: Record<string, string | number | undefined>) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.plans(org, query),
    queryFn: () => api.listPlans(query),
    enabled: Boolean(org),
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

export const useCalendar = (query: { from: string; to: string; mine?: boolean; team_id?: string }) => {
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

/** The roster including archived people, for the People page's filter. */
export const usePeopleWithArchived = (enabled: boolean) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.peopleWithArchived(org),
    queryFn: () => api.listPeople({ include_archived: true }),
    enabled: Boolean(org) && enabled,
  });
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

export const useRosterAudit = (personId: string | null, enabled = true) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.rosterAudit(org, personId),
    queryFn: () => api.rosterAudit({ ...(personId ? { person_id: personId } : {}), limit: 50 }),
    enabled: Boolean(org) && enabled,
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

export const useMessages = (query: { box: 'sent' | 'received'; plan_id?: string }) => {
  const org = useOrg();
  return useQuery({ queryKey: keys.messages(org, query), queryFn: () => api.listMessages(query), enabled: Boolean(org) });
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

/** Polled: the API rechecks participation on every read, so access ends when membership does. */
export const useConversations = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.conversations(org),
    queryFn: () => api.conversations(),
    enabled: Boolean(org),
    refetchInterval: 30_000,
  });
};

export const useConversation = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.conversation(org, id ?? ''),
    queryFn: () => api.getConversation(id!),
    enabled: Boolean(org && id),
    refetchInterval: 10_000,
    retry: false,
  });
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
