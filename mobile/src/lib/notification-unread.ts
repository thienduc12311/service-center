import type { NotificationFeedItem } from '@service-center/shared';

/**
 * The unread count the notifications screen shows. The bell count is its own
 * query (polled every 60 s) and can lag behind the feed, which would put
 * "All caught up" above unread rows. Rows already on screen are evidence of
 * at least that many unread notifications, so the larger of the two wins.
 */
export const displayedUnreadCount = (
  bellUnread: number,
  items: ReadonlyArray<Pick<NotificationFeedItem, 'read_at'>>,
): number => Math.max(bellUnread, items.filter((item) => !item.read_at).length);
