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

/**
 * Unread count for one recipient across the organizations they are still an
 * active member of — the number pushes put on the app-icon badge. Matches
 * `account_unread` from `GET /notifications/unread-count`, whose RLS hides
 * rows from organizations the person has left, so the badge never counts
 * notifications the app can no longer open.
 */
export const unreadCount = async (userId: string): Promise<number> => {
  const memberships = await unwrap(
    adminDb.from('organization_members').select('organization_id').eq('user_id', userId).eq('status', 'active'),
  );
  const organizationIds = (memberships ?? []).map((row) => row.organization_id);
  if (organizationIds.length === 0) return 0;
  const { count, error } = await adminDb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('organization_id', organizationIds)
    .is('read_at', null);
  if (error) throw new Error(`Could not count unread notifications: ${error.message}`);
  return count ?? 0;
};
