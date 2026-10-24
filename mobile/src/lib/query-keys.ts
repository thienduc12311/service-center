import type {
  CalendarLayersRequest,
  CalendarQueryRequest,
  CombinedScheduleQuery,
  FileOwnerKind,
  ListPlanTemplatesRequest,
  ListSongsQuery,
  PlanBrowserFilters,
  PlanNeighbourQueries,
  ReportFiltersRequest,
} from '@service-center/shared';
import type { ProtectedQueryScope } from './session-lifecycle';

const privateRoot = (scope: ProtectedQueryScope | null) =>
  [
    'private',
    scope?.userId ?? null,
    scope?.organizationId ?? null,
    scope?.generation ?? null,
  ] as const;

export const queryKeys = {
  privateRoot,
  organization: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'organization'] as const,
  /** Prefix for every schedule window; invalidate this after an answer. */
  schedule: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'schedule'] as const,
  scheduleWindow: (scope: ProtectedQueryScope | null, window: 'upcoming' | 'history') =>
    [...privateRoot(scope), 'schedule', window] as const,
  /** Prefix for every calendar range. */
  calendarAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'calendar'] as const,
  /** MOB-012: active service types, the plans browser's filter. */
  serviceTypes: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'service-types'] as const,
  /** MOB-012: prefix for every plans-browser page and neighbour read. */
  plans: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'plans'] as const,
  planList: (scope: ProtectedQueryScope | null, filters: PlanBrowserFilters) =>
    [...privateRoot(scope), 'plans', 'list', filters] as const,
  planNeighbours: (scope: ProtectedQueryScope | null, planId: string, queries: PlanNeighbourQueries | null) =>
    [...privateRoot(scope), 'plans', 'neighbours', planId, queries] as const,
  /** MOB-013: saved templates and sections (plan editors only). */
  planTemplates: (scope: ProtectedQueryScope | null, filter: ListPlanTemplatesRequest) =>
    [...privateRoot(scope), 'plan-templates', filter] as const,
  /** MOB-028: prefix for every plan read; a library write can change a plan's inherited arrangement or key. */
  planAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'plan'] as const,
  plan: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan', planId ?? null] as const,
  /** F14: the plan's rehearsal manifest (names versions, never URLs). */
  rehearsal: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'rehearsal', planId ?? null] as const,
  /** MOB-026: prefix for every manifest; any file change can alter what a plan rehearses. */
  rehearsalAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'rehearsal'] as const,
  /** MOB-030: prefix for every F14 media bundle read (list and detail). */
  mediaAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'media'] as const,
  mediaList: (scope: ProtectedQueryScope | null, query: string, includeArchived: boolean) =>
    [...privateRoot(scope), 'media', 'list', query, includeArchived] as const,
  media: (scope: ProtectedQueryScope | null, mediaId: string | null | undefined) =>
    [...privateRoot(scope), 'media', 'detail', mediaId ?? null] as const,
  /** MOB-026: prefix for every F13 file read; invalidate this after any file write. */
  filesAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'files'] as const,
  /** MOB-026: every file a plan uses (its own, its items', song/arrangement and linked defaults). */
  planFiles: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'files', 'plan', planId ?? null] as const,
  /** MOB-026: the files one parent owns (song, arrangement, service type). */
  parentFiles: (scope: ProtectedQueryScope | null, ownerKind: FileOwnerKind, ownerId: string | null | undefined) =>
    [...privateRoot(scope), 'files', 'parent', ownerKind, ownerId ?? null] as const,
  /** MOB-026: one file with every version and plan link the caller may see. */
  file: (scope: ProtectedQueryScope | null, fileId: string | null | undefined) =>
    [...privateRoot(scope), 'files', 'detail', fileId ?? null] as const,
  /** MOB-026: one text document version (null = current). */
  fileDocument: (scope: ProtectedQueryScope | null, fileId: string | null | undefined, versionId: string | null) =>
    [...privateRoot(scope), 'files', 'document', fileId ?? null, versionId] as const,
  /** MOB-014/016: F09 notes the caller may read on a plan (the server filters by audience). */
  planNotes: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan-notes', planId ?? null] as const,
  /** MOB-016: one item's F09 discussion (newest page; older pages are read on demand). */
  itemComments: (scope: ProtectedQueryScope | null, itemId: string | null | undefined) =>
    [...privateRoot(scope), 'item-comments', itemId ?? null] as const,
  /** MOB-016: current participants of a plan's item threads, the only people worth mentioning. */
  mentionCandidates: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'mention-candidates', planId ?? null] as const,
  /** MOB-014: an arrangement's F15 labeled keys, offered as plan-only service keys. */
  /** MOB-028: prefix for every arrangement's labeled keys and file scopes. */
  arrangementMaterialsAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'arrangement-materials'] as const,
  arrangementMaterials: (scope: ProtectedQueryScope | null, arrangementId: string | null | undefined) =>
    [...privateRoot(scope), 'arrangement-materials', arrangementId ?? null] as const,
  /** MOB-015: F08 scheduled reminders and per-Person/channel delivery history for one plan. */
  planDeliveries: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan-deliveries', planId ?? null] as const,
  /** MOB-015: F08 effective/explicit reminder policies at one scope (organization when both are null). */
  reminderPolicies: (scope: ProtectedQueryScope | null, serviceTypeId: string | null, teamId: string | null) =>
    [...privateRoot(scope), 'reminder-policies', serviceTypeId, teamId] as const,
  /** MOB-020: the signed-in Person's own F08 reminder channels in this organization. */
  myReminderPreferences: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'reminder-preferences', 'me'] as const,
  /** MOB-017: prefix for a plan's F16 attendance sheets and histories; invalidate this after a batch. */
  attendanceAll: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'attendance', planId ?? null] as const,
  /** MOB-017: the sheet for one plan time (null = the server's default time). */
  attendance: (scope: ProtectedQueryScope | null, planId: string | null | undefined, timeId: string | null) =>
    [...privateRoot(scope), 'attendance', planId ?? null, 'sheet', timeId] as const,
  /** MOB-017: every mark and correction of one Person at one plan time. */
  attendanceHistory: (scope: ProtectedQueryScope | null, planId: string, timeId: string, personId: string) =>
    [...privateRoot(scope), 'attendance', planId, 'history', timeId, personId] as const,
  /** MOB-018: prefix for every F09 targeted-message list and detail; invalidate this after a send or retry. */
  messagesAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'messages'] as const,
  messageList: (scope: ProtectedQueryScope | null, box: 'sent' | 'received') =>
    [...privateRoot(scope), 'messages', 'list', box] as const,
  /** MOB-018: one message — the sender's per-channel outcomes, or a recipient's own copy. */
  message: (scope: ProtectedQueryScope | null, messageId: string | null | undefined) =>
    [...privateRoot(scope), 'messages', 'detail', messageId ?? null] as const,
  /** MOB-018: personal and shared message templates (senders only). */
  messageTemplates: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'message-templates'] as const,
  /** MOB-019: prefix for every F09 team/plan conversation read; invalidate this after a post, read, mute or moderation. */
  conversationsAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'conversations'] as const,
  conversationList: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'conversations', 'list'] as const,
  /** MOB-019: one conversation's summary, newest page and open reports (moderators). */
  conversation: (scope: ProtectedQueryScope | null, conversationId: string | null | undefined) =>
    [...privateRoot(scope), 'conversations', 'detail', conversationId ?? null] as const,
  conversationSearch: (scope: ProtectedQueryScope | null, conversationId: string, query: string) =>
    [...privateRoot(scope), 'conversations', 'search', conversationId, query] as const,
  /** MOB-019: current participants of one conversation, the only people worth mentioning. */
  conversationMentionCandidates: (scope: ProtectedQueryScope | null, conversationId: string | null | undefined) =>
    [...privateRoot(scope), 'conversations', 'mention-candidates', conversationId ?? null] as const,
  /** MOB-028: prefix for every song detail. */
  songAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'song'] as const,
  song: (scope: ProtectedQueryScope | null, songId: string | null | undefined) =>
    [...privateRoot(scope), 'song', songId ?? null] as const,
  /** MOB-028: prefix for every library page and picker search; invalidate this after any library write. */
  songsAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'songs'] as const,
  songs: (scope: ProtectedQueryScope | null, query: string) =>
    [...privateRoot(scope), 'songs', query] as const,
  /** MOB-028: the paged library for one search, sort, scope and filter set (pages are read on demand). */
  songLibrary: (scope: ProtectedQueryScope | null, query: Partial<ListSongsQuery>) =>
    [...privateRoot(scope), 'songs', 'library', query] as const,
  /** MOB-022: one calendar request (range, Only me, team) exactly as sent. */
  calendar: (scope: ProtectedQueryScope | null, query: CalendarQueryRequest) =>
    [...privateRoot(scope), 'calendar', query] as const,
  /** MOB-022: F16 opt-in layers for one team and range; the server re-checks access on every read. */
  calendarLayers: (scope: ProtectedQueryScope | null, query: CalendarLayersRequest | null) =>
    [...privateRoot(scope), 'calendar', 'layers', query] as const,
  /** MOB-022: whether my personal calendar link is active. Never the URL: that stays in screen memory. */
  personalCalendarFeed: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'calendar-feed', 'me'] as const,
  /** MOB-022: an F16 schedule report for the filters that were run. */
  scheduleReport: (scope: ProtectedQueryScope | null, filters: ReportFiltersRequest | null) =>
    [...privateRoot(scope), 'reports', 'schedule', filters] as const,
  /** MOB-022: my F16 report exports (all kinds), polled while one is being built. */
  reportExports: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'reports', 'exports'] as const,
  /** MOB-023: a plan's F12 service times, their runs and whether I may control Live. */
  liveRuns: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'live', 'plan', planId ?? null] as const,
  /** MOB-023: one run's authoritative state with the clock offset measured on that read. */
  liveRun: (scope: ProtectedQueryScope | null, runId: string | null | undefined) =>
    [...privateRoot(scope), 'live', 'run', runId ?? null] as const,
  /** MOB-023: one run's transitions, corrections and planned-versus-actual. */
  liveRunHistory: (scope: ProtectedQueryScope | null, runId: string | null | undefined) =>
    [...privateRoot(scope), 'live', 'history', runId ?? null] as const,
  /**
   * MOB-032: my own cross-organization choices and combined schedule. Not about
   * the active organization, but still kept under the account/generation root,
   * so a sign-out, account change or switch never shows an earlier answer.
   */
  scheduleSettings: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'across', 'settings'] as const,
  combinedScheduleAll: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'across', 'combined'] as const,
  combinedSchedule: (scope: ProtectedQueryScope | null, window: CombinedScheduleQuery) =>
    [...privateRoot(scope), 'across', 'combined', window] as const,
  blockouts: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'blockouts'] as const,
  /** MOB-011: a delegate's view of another Person's blockouts sits under the same prefix. */
  blockoutsFor: (scope: ProtectedQueryScope | null, personId: string) =>
    [...privateRoot(scope), 'blockouts', 'person', personId] as const,
  /** Own preferences when `personId` is omitted; a delegated Person's otherwise. */
  schedulingPreferences: (scope: ProtectedQueryScope | null, personId?: string | null) =>
    [...privateRoot(scope), 'scheduling-preferences', personId ?? 'self'] as const,
  availabilityReview: (scope: ProtectedQueryScope | null, personId: string) =>
    [...privateRoot(scope), 'availability-review', personId] as const,
  /** MOB-011: grants given and received; invalidate this after a grant, revoke or delegated answer. */
  delegations: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'delegations'] as const,
  delegatedSchedule: (scope: ProtectedQueryScope | null, delegationId: string | null | undefined) =>
    [...privateRoot(scope), 'delegations', 'schedule', delegationId ?? null] as const,
  people: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'people'] as const,
  /** MOB-031: the directory with or without archived people; invalidate `people` after any roster write. */
  directory: (scope: ProtectedQueryScope | null, includeArchived: boolean) =>
    [...privateRoot(scope), 'people', 'directory', includeArchived] as const,
  /** MOB-031: one Person's record as the server returns it to this caller (404 when private). */
  person: (scope: ProtectedQueryScope | null, personId: string | null | undefined) =>
    [...privateRoot(scope), 'people', 'person', personId ?? null] as const,
  personTags: (scope: ProtectedQueryScope | null, personId: string | null | undefined) =>
    [...privateRoot(scope), 'people', 'tags', personId ?? null] as const,
  teams: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'teams'] as const,
  /** MOB-009: every signup-opening read; invalidate this after a claim or decision. */
  opportunities: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'opportunities'] as const,
  opportunityList: (scope: ProtectedQueryScope | null, planId: string | null) =>
    [...privateRoot(scope), 'opportunities', 'list', planId] as const,
  opportunity: (scope: ProtectedQueryScope | null, opportunityId: string | null | undefined) =>
    [...privateRoot(scope), 'opportunities', 'detail', opportunityId ?? null] as const,
  opportunityClaims: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'opportunities', 'claims', planId ?? null] as const,
  /** MOB-010: the replacement requests this Person may see (requester, candidate or scheduler). */
  replacements: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'replacements'] as const,
  notifications: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications'] as const,
  notificationUnread: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications', 'unread'] as const,
  notificationFeed: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications', 'feed'] as const,
};
