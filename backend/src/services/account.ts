import type { AccountDeletionPlan, AccountDeletionResult, BlockedUser, UserBlockRow } from '@service-center/shared';
import { adminDb, raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  mapAccountDeletionPlan,
  mapBlockedUser,
  userAvatarFolder,
  type AccountDeletionPlanRow,
  type BlockedUserRow,
} from '../model/account.model.js';

/** The signed-in person acting on their own account. */
export interface AccountCaller {
  /** RLS-scoped to the caller. */
  db: Db;
  userId: string;
}

const AVATAR_BUCKET = 'avatars';

/** What deleting the caller's account would do (read as the caller). */
export const getAccountDeletionPlan = async (caller: AccountCaller): Promise<AccountDeletionPlan> => {
  const rows = (await unwrap(raw(caller.db).rpc('my_account_deletion_plan'))) as AccountDeletionPlanRow[] | null;
  return mapAccountDeletionPlan(rows ?? []);
};

/** Removes the caller's own pictures. Organization-uploaded pictures belong to the organization. */
export const removeOwnAvatars = async (userId: string): Promise<void> => {
  const folder = userAvatarFolder(userId);
  const bucket = adminDb.storage.from(AVATAR_BUCKET);
  const { data, error } = await bucket.list(folder, { limit: 1000 });
  if (error) throw new HttpError(502, 'Could not remove your profile picture; try again');
  const paths = (data ?? []).map((object) => `${folder}/${object.name}`);
  if (paths.length === 0) return;
  const removed = await bucket.remove(paths);
  if (removed.error) throw new HttpError(502, 'Could not remove your profile picture; try again');
};

/**
 * Permanently deletes the caller's account (App Store Review Guideline
 * 5.1.1(v)). Refused with 409 `account_deletion_blocked` while it would leave
 * an organization's other members without an owner. Organizations nobody
 * else is in are deleted with it. Every step can be retried: if deleting the
 * login fails, calling again finishes the job.
 */
export const deleteAccount = async (caller: AccountCaller): Promise<AccountDeletionResult> => {
  const plan = await getAccountDeletionPlan(caller);
  if (!plan.can_delete) {
    throw new HttpError(
      409,
      'Make someone else an owner of your organizations before deleting your account',
      'account_deletion_blocked',
      plan.organizations.filter((org) => org.outcome === 'blocked'),
    );
  }

  // Re-checks the plan under lock, so a member who joined since is still protected.
  const deleted = (await unwrap(
    raw(adminDb).rpc('prepare_account_deletion', { p_user: caller.userId }),
  )) as string[] | null;

  await removeOwnAvatars(caller.userId);

  const { error } = await adminDb.auth.admin.deleteUser(caller.userId);
  if (error) {
    console.error(`[account] deleting the login failed (${error.status ?? 'no status'})`);
    throw new HttpError(502, 'Could not delete your account; try again');
  }
  return { deleted_organization_ids: deleted ?? [] };
};

export const listBlockedUsers = async (caller: AccountCaller): Promise<BlockedUser[]> => {
  const rows = (await unwrap(raw(caller.db).rpc('my_blocked_users'))) as BlockedUserRow[] | null;
  return (rows ?? []).map(mapBlockedUser);
};

/** Idempotent. 404 unless the two people share an organization. */
export const blockUser = async (caller: AccountCaller, blockedId: string): Promise<UserBlockRow> =>
  (await unwrapOne(raw(caller.db).rpc('block_user', { p_user: blockedId }))) as UserBlockRow;

/** Idempotent. */
export const unblockUser = async (caller: AccountCaller, blockedId: string): Promise<void> => {
  await unwrap(caller.db.from('user_blocks').delete().eq('blocker_id', caller.userId).eq('blocked_id', blockedId));
};
