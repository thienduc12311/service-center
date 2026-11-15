/**
 * Account deletion and user blocking (App Store Review Guidelines 5.1.1(v)
 * and 1.2). See supabase/migrations/20261115000000_account_deletion_and_user_blocks.sql.
 */

/**
 * What deleting the account does to an organization the person owns alone:
 * `deleted` when nobody else is an active member (it goes with the account),
 * `blocked` when other members would be left without an owner.
 */
export type AccountDeletionOutcome = 'deleted' | 'blocked';

/** One organization affected by deleting the account. */
export interface AccountDeletionOrganization {
  organization_id: string;
  organization_name: string;
  outcome: AccountDeletionOutcome;
}

/** `GET /api/v1/me/account-deletion`: what deleting the account would do. */
export interface AccountDeletionPlan {
  /** False while any organization is `blocked`. */
  can_delete: boolean;
  /** Only organizations the person owns alone; any other membership simply ends. */
  organizations: AccountDeletionOrganization[];
}

/** `DELETE /api/v1/me`: the account is gone; these organizations went with it. */
export interface AccountDeletionResult {
  deleted_organization_ids: string[];
}

/** `user_blocks`: `blocker_id` no longer sees or hears from `blocked_id`. */
export type UserBlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

/** Someone the caller blocked, by the name they knew them by. */
export interface BlockedUser {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}
