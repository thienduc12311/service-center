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
  plan: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'plan', planId ?? null] as const,
  /** F14: the plan's rehearsal manifest (names versions, never URLs). */
  rehearsal: (scope: ProtectedQueryScope | null, planId: string | null | undefined) =>
    [...privateRoot(scope), 'rehearsal', planId ?? null] as const,
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
  songbooks: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'songbooks'] as const,
  songbookSongs: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'songbook-songs'] as const,
  songbook: (scope: ProtectedQueryScope | null, songbookId: string | null | undefined) =>
    [...privateRoot(scope), 'songbook', songbookId ?? null] as const,
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
