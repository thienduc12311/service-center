/**
 * Super-admin user management: API error codes shared by the API and the
 * admin app.
 */

/** 401: the account was blocked by a super admin. */
export const ACCOUNT_BLOCKED = 'account_blocked';
/** 409: super admins can't be blocked or deleted; revoke their access first. */
export const TARGET_IS_PLATFORM_ADMIN = 'target_is_platform_admin';
/** 409: removing this super admin would leave none. */
export const LAST_PLATFORM_ADMIN = 'last_platform_admin';
/** 409: the invited address already belongs to a super admin. */
export const ALREADY_PLATFORM_ADMIN = 'already_platform_admin';
/** 409: the account is blocked; unblock it first. */
export const USER_BLOCKED = 'user_blocked';
/** 409: the invitation was accepted, revoked or expired meanwhile. */
export const INVITATION_NOT_OPEN = 'invitation_not_open';
/** 400: you can't block, delete or revoke your own account here. */
export const CANNOT_TARGET_SELF = 'cannot_target_self';
/** 409: deleting the account would leave a church's other members without an owner. */
export const ACCOUNT_DELETION_BLOCKED = 'account_deletion_blocked';
/** 400: the typed email does not match the account. */
export const CONFIRMATION_MISMATCH = 'confirmation_mismatch';
