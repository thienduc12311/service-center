import type { NotificationRow } from '@service-center/shared';
import { adminDb, unwrap } from '../lib/supabase.js';
import { toNotificationInsert, type NotificationDraft } from '../model/notification.model.js';

/**
 * Writes the in-app feed rows behind the bell icon.
 *
 * Uses the service role deliberately: the person who triggers the event (a
 * scheduler adding someone to a plan) has no rights to insert a row owned by
 * the recipient, and there is no RLS insert policy on `notifications` for that
 * reason. Only the delivery worker calls this, after re-checking that the
 * recipient may still see the event.
 *
 * Every draft carries a dedupe key, so running the same delivery twice (a
 * retry, a second worker) returns the rows already written instead of adding
 * copies.
 */
export const ensureFeedRows = async (
  drafts: ReadonlyArray<NotificationDraft & { dedupeKey: string }>,
): Promise<NotificationRow[]> => {
  if (drafts.length === 0) return [];
  await unwrap(
    adminDb
      .from('notifications')
      .upsert(drafts.map(toNotificationInsert), { onConflict: 'dedupe_key', ignoreDuplicates: true }),
  );
  return (
    (await unwrap(
      adminDb
        .from('notifications')
        .select('*')
        .in('dedupe_key', drafts.map((draft) => draft.dedupeKey))
        .order('created_at', { ascending: false }),
    )) ?? []
  );
};

/** Unread count for one recipient across their organizations, used for the iOS badge. */
export const unreadCount = async (userId: string): Promise<number> => {
  const { count, error } = await adminDb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw new Error(`Could not count unread notifications: ${error.message}`);
  return count ?? 0;
};
