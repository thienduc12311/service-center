import type { NotificationRow } from '@service-center/shared';
import { adminDb, unwrap } from '../lib/supabase.js';
import {
  toNotificationInsert,
  toPushMessage,
  type NotificationDraft,
  type PushMessage,
} from '../model/notification.model.js';
import { sendPushMessages } from './expo-push.js';

/**
 * Writes the in-app feed rows behind the bell icon and pushes them to every
 * device the recipients have registered.
 *
 * Uses the service role deliberately: the person who triggers the event (a
 * scheduler adding someone to a plan) has no rights to insert a row owned by
 * the recipient, and there is no RLS insert policy on `notifications` for that
 * reason. Callers must already have established that the actor may act in the
 * organization — every current caller runs behind `requireManager`, or writes
 * only to itself.
 */
export const createNotifications = async (
  drafts: NotificationDraft[],
): Promise<NotificationRow[]> => {
  if (drafts.length === 0) return [];

  const rows = await unwrap(
    adminDb.from('notifications').insert(drafts.map(toNotificationInsert)).select('*'),
  );
  const created = rows ?? [];

  // Delivery must never fail the action that caused the notification — the row
  // is already stored, and the app shows it on next refresh.
  try {
    await pushToDevices(created);
  } catch (error) {
    console.warn('[push] could not deliver push notifications', error);
  }

  return created;
};

/** Unread count per recipient, used for the iOS badge. */
const unreadCounts = async (userIds: string[]): Promise<Map<string, number>> => {
  const rows = await unwrap(
    adminDb.from('notifications').select('user_id').in('user_id', userIds).is('read_at', null),
  );
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }
  return counts;
};

const pushToDevices = async (notifications: NotificationRow[]): Promise<void> => {
  if (notifications.length === 0) return;
  const userIds = [...new Set(notifications.map((n) => n.user_id))];

  const devices = await unwrap(
    adminDb.from('device_push_tokens').select('user_id, token').in('user_id', userIds),
  );
  if (!devices?.length) return;

  const tokensByUser = new Map<string, string[]>();
  for (const device of devices) {
    const list = tokensByUser.get(device.user_id);
    if (list) list.push(device.token);
    else tokensByUser.set(device.user_id, [device.token]);
  }

  const badges = await unreadCounts(userIds);
  const messages: PushMessage[] = [];
  for (const notification of notifications) {
    for (const token of tokensByUser.get(notification.user_id) ?? []) {
      messages.push(toPushMessage(notification, token, badges.get(notification.user_id)));
    }
  }

  const { invalidTokens } = await sendPushMessages(messages);
  if (invalidTokens.length) {
    // The app was uninstalled or the token was rotated; keep the table clean.
    await unwrap(adminDb.from('device_push_tokens').delete().in('token', invalidTokens));
  }
};
