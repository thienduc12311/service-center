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
  songbooks: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'songbooks'] as const,
  songbookSongs: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'songbook-songs'] as const,
  songbook: (scope: ProtectedQueryScope | null, songbookId: string | null | undefined) =>
    [...privateRoot(scope), 'songbook', songbookId ?? null] as const,
  notifications: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications'] as const,
  notificationUnread: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications', 'unread'] as const,
  notificationFeed: (scope: ProtectedQueryScope | null) =>
    [...privateRoot(scope), 'notifications', 'feed'] as const,
};
