import type { ProtectedQueryScope } from './session-lifecycle';
import { queryKeys } from './query-keys';

/** Account, organization and session-generation scoped notification keys. */
export const notificationKeys = {
  unread: (scope: ProtectedQueryScope | null) => queryKeys.notificationUnread(scope),
  feed: (scope: ProtectedQueryScope | null) => queryKeys.notificationFeed(scope),
  all: (scope: ProtectedQueryScope | null) => queryKeys.notifications(scope),
};
