import { config } from '../config.js';
import { adminDb, unwrap } from '../lib/supabase.js';

/** How long notifications are kept before the scheduled worker deletes them. */
export interface NotificationRetentionPolicy {
  readDays: number;
  unreadDays: number;
  /** Most rows deleted by one run; the rest wait for the next run. */
  limit: number;
}

/** What one retention run did. */
export interface NotificationRetentionResult {
  deleted: number;
}

export const defaultNotificationRetentionPolicy = (): NotificationRetentionPolicy => ({
  readDays: config.NOTIFICATION_READ_RETENTION_DAYS,
  unreadDays: config.NOTIFICATION_UNREAD_RETENTION_DAYS,
  limit: 1000,
});

/**
 * Deletes old notifications, oldest first, in one bounded batch. Service role
 * only: it crosses every recipient. A notification is just a per-recipient
 * pointer, so nothing it points at is affected.
 */
export const runNotificationRetention = async (
  policy: NotificationRetentionPolicy = defaultNotificationRetentionPolicy(),
): Promise<NotificationRetentionResult> => {
  const deleted = await unwrap(
    adminDb.rpc('prune_notifications', {
      p_read_days: policy.readDays,
      p_unread_days: policy.unreadDays,
      p_limit: policy.limit,
    }),
  );
  return { deleted: deleted ?? 0 };
};

/** For scheduled runs: a failed clean-up must not fail the delivery run it rides along with. */
export const runNotificationRetentionSafely = async (): Promise<NotificationRetentionResult | null> => {
  try {
    return await runNotificationRetention();
  } catch (error) {
    console.warn(`[notifications] retention failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
};
