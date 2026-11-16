import {
  ACCOUNT_DELETION_BLOCKED,
  CANNOT_TARGET_SELF,
  CONFIRMATION_MISMATCH,
  TARGET_IS_PLATFORM_ADMIN,
  type AdminUserDeletionPlan,
  type AdminUserDeletionResult,
  type AdminUserDetail,
  type AdminUserSummary,
  type InvitePlatformAdminInput,
  type MyPlatformAdminInvitation,
  type PlatformAdminInvitation,
  type PlatformAdminInvitationRow,
  type PlatformAdminRoster,
  type PlatformUserBlockRow,
} from '@service-center/shared';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import {
  mapAdminDeletedOrganization,
  mapAdminUserDeletionChurch,
  mapAdminUserSummary,
  mapMyPlatformAdminInvitation,
  mapPlatformAdmin,
  mapPlatformAdminInvitation,
  type AdminDeletedOrganizationRow,
  type AdminUserDeletionPlanRow,
  type AdminUserSummaryRow,
  type MyPlatformAdminInvitationRow,
  type PlatformAdminInvitationListRow,
  type PlatformAdminRow,
} from '../model/platform-users.model.js';
import { removeOwnAvatars } from './account.js';
import { platformAdminInvitationEmail } from './email/templates/platform-admin-invitation.js';
import { sendPlatformEmails } from './platform-email.js';
import type { PlatformActor } from './platform-admin.js';

/**
 * Super-admin user management and super-admin invitations. Service role
 * only, reached through `requirePlatformAdmin` (except the invitee's own
 * invitation routes). Each database function re-checks the actor and writes
 * platform_audit_log in the same transaction as the change.
 */

// --------------------------------------------------------------- users -----

export const listUsers = async (): Promise<AdminUserSummary[]> => {
  const rows = (await unwrap(raw(adminDb).rpc('admin_user_summaries'))) as AdminUserSummaryRow[] | null;
  return (rows ?? []).map((row) => mapAdminUserSummary(row));
};

const getUserSummary = async (userId: string): Promise<AdminUserSummary> => {
  const rows = (await unwrap(raw(adminDb).rpc('admin_user_summaries', { p_user: userId }))) as AdminUserSummaryRow[] | null;
  const row = rows?.[0];
  if (!row) throw HttpError.notFound('User not found');
  return mapAdminUserSummary(row);
};

/** Whether `actor` may delete `user`, and which churches it touches. */
export const deletionPlanFor = (
  actor: PlatformActor,
  user: AdminUserSummary,
  churches: AdminUserDeletionPlan['churches'],
): AdminUserDeletionPlan => ({
  can_delete: user.id !== actor.userId && !user.is_platform_admin && churches.every((church) => church.outcome !== 'blocked'),
  churches,
});

export const getUserDetail = async (actor: PlatformActor, userId: string): Promise<AdminUserDetail> => {
  const user = await getUserSummary(userId);
  const rows = (await unwrap(raw(adminDb).rpc('admin_user_deletion_plan', { p_user: userId }))) as
    | AdminUserDeletionPlanRow[]
    | null;
  return { user, deletion: deletionPlanFor(actor, user, (rows ?? []).map(mapAdminUserDeletionChurch)) };
};

/** Bans the login and ends every session. Idempotent. */
export const blockUser = async (actor: PlatformActor, userId: string, reason: string): Promise<PlatformUserBlockRow> =>
  (await unwrap(
    raw(adminDb).rpc('admin_block_user', { p_actor: actor.userId, p_user: userId, p_reason: reason }),
  )) as PlatformUserBlockRow;

/** Idempotent. */
export const unblockUser = async (actor: PlatformActor, userId: string): Promise<void> => {
  await unwrap(raw(adminDb).rpc('admin_unblock_user', { p_actor: actor.userId, p_user: userId }));
};

/**
 * Permanently deletes an account under the same rules as deleting your own.
 * The typed email must match. Refused with 409 `account_deletion_blocked`
 * (details: the churches) while a church would be left without an owner.
 */
export const deleteUser = async (
  actor: PlatformActor,
  userId: string,
  confirmEmail: string,
): Promise<AdminUserDeletionResult> => {
  const { user, deletion } = await getUserDetail(actor, userId);
  if (!user.email || user.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
    throw new HttpError(400, 'Type the account’s email address to confirm', CONFIRMATION_MISMATCH);
  }
  if (user.id === actor.userId) {
    throw new HttpError(400, 'You can’t delete your own account here', CANNOT_TARGET_SELF);
  }
  if (user.is_platform_admin) {
    throw new HttpError(409, 'Revoke their super-admin access first', TARGET_IS_PLATFORM_ADMIN);
  }
  if (!deletion.can_delete) {
    throw new HttpError(
      409,
      'Make someone else an owner of these churches before deleting this account',
      ACCOUNT_DELETION_BLOCKED,
      deletion.churches.filter((church) => church.outcome === 'blocked'),
    );
  }

  try {
    await removeOwnAvatars(userId);
  } catch (error) {
    if (error instanceof HttpError) throw new HttpError(502, 'Could not remove their profile picture; try again');
    throw error;
  }

  // Re-checks the plan under lock, writes the audit line and deletes the login in one transaction.
  const rows = (await unwrap(raw(adminDb).rpc('admin_delete_user', { p_actor: actor.userId, p_user: userId }))) as
    | AdminDeletedOrganizationRow[]
    | null;
  return { deleted_organizations: (rows ?? []).map(mapAdminDeletedOrganization) };
};

// -------------------------------------------------------- super admins -----

export const listPlatformAdmins = async (): Promise<PlatformAdminRoster> => {
  const [admins, invitations] = await Promise.all([
    unwrap(raw(adminDb).rpc('admin_platform_admins')) as Promise<PlatformAdminRow[] | null>,
    unwrap(raw(adminDb).rpc('admin_platform_admin_invitations')) as Promise<PlatformAdminInvitationListRow[] | null>,
  ]);
  return {
    admins: (admins ?? []).map(mapPlatformAdmin),
    invitations: (invitations ?? []).map(mapPlatformAdminInvitation),
  };
};

interface ProfileLookup {
  id: string;
  full_name: string | null;
}

const profileByEmail = async (email: string): Promise<ProfileLookup | null> => {
  // ilike for case-insensitive equality; escape its wildcards.
  const pattern = email.replace(/[\\%_]/g, (match) => `\\${match}`);
  return unwrap(adminDb.from('profiles').select('id, full_name').ilike('email', pattern).limit(1).maybeSingle());
};

const profileName = async (userId: string): Promise<string | null> => {
  const row = await unwrap(adminDb.from('profiles').select('full_name').eq('id', userId).maybeSingle());
  return row?.full_name ?? null;
};

/**
 * Invites someone by email (re-inviting extends an open invitation) and
 * emails them a link to the admin dashboard. The email is best effort.
 */
export const invitePlatformAdmin = async (
  actor: PlatformActor,
  input: InvitePlatformAdminInput,
): Promise<PlatformAdminInvitation> => {
  const row = (await unwrap(
    raw(adminDb).rpc('admin_invite_platform_admin', { p_actor: actor.userId, p_email: input.email, p_days: input.days }),
  )) as PlatformAdminInvitationRow;
  const [inviterName, existing] = await Promise.all([profileName(actor.userId), profileByEmail(row.email)]);

  await sendPlatformEmails([
    {
      to: row.email,
      ...platformAdminInvitationEmail({
        inviterName,
        email: row.email,
        expiresAt: new Date(row.expires_at),
        adminUrl: config.ADMIN_APP_URL,
        hasAccount: existing !== null,
      }),
    },
  ]);
  return mapPlatformAdminInvitation({
    id: row.id,
    email: row.email,
    invited_by: row.invited_by,
    invited_by_name: inviterName,
    created_at: row.created_at,
    expires_at: row.expires_at,
  });
};

export const revokePlatformAdminInvitation = async (actor: PlatformActor, invitationId: string): Promise<void> => {
  await unwrap(
    raw(adminDb).rpc('admin_revoke_platform_admin_invitation', { p_actor: actor.userId, p_invitation: invitationId }),
  );
};

/** Also ends any "enter as owner" access they hold. */
export const revokePlatformAdmin = async (actor: PlatformActor, userId: string): Promise<void> => {
  await unwrap(raw(adminDb).rpc('admin_revoke_platform_admin', { p_actor: actor.userId, p_user: userId }));
};

// ------------------------------------------------- the invitee's side ------

/** The signed-in person's open invitation (their address must be confirmed). */
export const getMyPlatformAdminInvitation = async (userId: string): Promise<MyPlatformAdminInvitation | null> => {
  const rows = (await unwrap(raw(adminDb).rpc('my_platform_admin_invitation', { p_user: userId }))) as
    | MyPlatformAdminInvitationRow[]
    | null;
  const row = rows?.[0];
  return row ? mapMyPlatformAdminInvitation(row) : null;
};

export const acceptPlatformAdminInvitation = async (userId: string, invitationId: string): Promise<void> => {
  await unwrap(
    raw(adminDb).rpc('accept_platform_admin_invitation', { p_user: userId, p_invitation: invitationId }),
  );
};
