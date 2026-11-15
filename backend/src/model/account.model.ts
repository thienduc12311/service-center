import type {
  AccountDeletionOrganization,
  AccountDeletionOutcome,
  AccountDeletionPlan,
  BlockedUser,
} from '@service-center/shared';

/** A row of `my_account_deletion_plan()`. */
export interface AccountDeletionPlanRow {
  organization_id: string;
  organization_name: string;
  outcome: string;
}

/** A row of `my_blocked_users()`. */
export interface BlockedUserRow {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  blocked_at: string;
}

const isOutcome = (value: string): value is AccountDeletionOutcome => value === 'deleted' || value === 'blocked';

export const mapAccountDeletionOrganization = (row: AccountDeletionPlanRow): AccountDeletionOrganization => {
  // Unknown outcomes are treated as blocking: never delete on a value we don't understand.
  const outcome: AccountDeletionOutcome = isOutcome(row.outcome) ? row.outcome : 'blocked';
  return { organization_id: row.organization_id, organization_name: row.organization_name, outcome };
};

export const mapAccountDeletionPlan = (rows: readonly AccountDeletionPlanRow[]): AccountDeletionPlan => {
  const organizations = rows.map(mapAccountDeletionOrganization);
  return { can_delete: organizations.every((org) => org.outcome !== 'blocked'), organizations };
};

export const mapBlockedUser = (row: BlockedUserRow): BlockedUser => ({
  user_id: row.user_id,
  full_name: row.full_name,
  avatar_url: row.avatar_url,
  blocked_at: row.blocked_at,
});

/** Storage path prefix of the person's own pictures in the `avatars` bucket (see shared `avatarObjectPath`). */
export const userAvatarFolder = (userId: string): string => `users/${userId}`;
