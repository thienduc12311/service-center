/**
 * Query keys for the notification centre. Namespaced by organization like
 * every other key in the app, so switching org can't show a stale badge.
 */
export const notificationKeys = {
  unread: (organizationId: string | null) => ['notifications', 'unread', organizationId] as const,
  feed: (organizationId: string | null) => ['notifications', 'feed', organizationId] as const,
  all: ['notifications'] as const,
};
