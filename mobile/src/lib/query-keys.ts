import type { ListPlanTemplatesRequest, PlanBrowserFilters, PlanNeighbourQueries } from '@service-center/shared';
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
  plan: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan', planId ?? null] as const,
  /** F14: the plan's rehearsal manifest (names versions, never URLs). */
  rehearsal: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'rehearsal', planId ?? null] as const,
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
  arrangementMaterials: (scope: ProtectedQueryScope | null, arrangementId: string | null | undefined) =>
    [...privateRoot(scope), 'arrangement-materials', arrangementId ?? null] as const,
  /** MOB-015: F08 scheduled reminders and per-Person/channel delivery history for one plan. */
  planDeliveries: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan-deliveries', planId ?? null] as const,
  /** MOB-015: F08 effective/explicit reminder policies at one scope (organization when both are null). */
  reminderPolicies: (scope: ProtectedQueryScope | null, serviceTypeId: string | null, teamId: string | null) =>
    [...privateRoot(scope), 'reminder-policies', serviceTypeId, teamId] as const,
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
  song: (scope: ProtectedQueryScope | null, songId: string | null | undefined) =>
    [...privateRoot(scope), 'song', songId ?? null] as const,
  songs: (scope: ProtectedQueryScope | null, query: string) =>
    [...privateRoot(scope), 'songs', query] as const,
  calendar: (
    scope: ProtectedQueryScope | null,
    range: Readonly<{ from: string; to: string }>,
    calendarScope: 'all' | 'mine',
  ) => [...privateRoot(scope), 'calendar', range, calendarScope] as const,
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
