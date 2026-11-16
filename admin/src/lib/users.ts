import type { AdminUserMembership, AdminUserSummary, OrgRole } from '@service-center/shared';

/** The Users page's status filter. */
export type UserStatusFilter = 'all' | 'active' | 'blocked' | 'super_admin' | 'no_church';

export interface UserFilter {
  query: string;
  status: UserStatusFilter;
  /** Only members of this church; null for every account. */
  churchId: string | null;
}

export const EMPTY_USER_FILTER: UserFilter = { query: '', status: 'all', churchId: null };

/** Memberships that count as belonging to a church (not invited or inactive ones). */
export const currentMemberships = (user: AdminUserSummary): AdminUserMembership[] =>
  user.memberships.filter((membership) => membership.status === 'active' || membership.status === 'suspended');

const matchesStatus = (user: AdminUserSummary, status: UserStatusFilter): boolean => {
  switch (status) {
    case 'all':
      return true;
    case 'active':
      return user.block === null;
    case 'blocked':
      return user.block !== null;
    case 'super_admin':
      return user.is_platform_admin;
    case 'no_church':
      return currentMemberships(user).length === 0;
  }
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase('en');

/** Search name, email and church names; then the status and church filters. */
export const filterUsers = (users: readonly AdminUserSummary[], filter: UserFilter): AdminUserSummary[] => {
  const query = normalize(filter.query);
  return users.filter((user) => {
    if (!matchesStatus(user, filter.status)) return false;
    if (filter.churchId && !user.memberships.some((membership) => membership.organization_id === filter.churchId)) return false;
    if (!query) return true;
    return [user.full_name, user.email, ...user.memberships.map((membership) => membership.organization_name)].some(
      (value) => value !== null && normalize(value).includes(query),
    );
  });
};

/** A church in the filter list, from every account's memberships. */
export interface UserChurchOption {
  id: string;
  name: string;
}

export const churchOptions = (users: readonly AdminUserSummary[]): UserChurchOption[] => {
  const byId = new Map<string, string>();
  for (const user of users) {
    for (const membership of user.memberships) byId.set(membership.organization_id, membership.organization_name);
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
};

/** The name to show for an account. */
export const userDisplayName = (user: Pick<AdminUserSummary, 'full_name' | 'email'>): string =>
  user.full_name?.trim() || user.email || 'Unnamed account';

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  scheduler: 'Scheduler',
  member: 'Member',
};

export const roleLabel = (role: OrgRole): string => ROLE_LABELS[role];

const MEMBERSHIP_STATUS_LABELS: Record<AdminUserMembership['status'], string> = {
  active: 'Active',
  invited: 'Invited',
  inactive: 'Inactive',
  suspended: 'Suspended (church disabled)',
};

export const membershipStatusLabel = (status: AdminUserMembership['status']): string => MEMBERSHIP_STATUS_LABELS[status];

/**
 * Churches this person is the only active owner of; blocking them leaves the
 * church with nobody who can manage it. Counts other owners from the full
 * account list (the summaries carry every membership).
 */
export const soleOwnedChurches = (user: AdminUserSummary, users: readonly AdminUserSummary[]): AdminUserMembership[] =>
  currentMemberships(user).filter(
    (membership) =>
      membership.role === 'owner' &&
      !users.some(
        (other) =>
          other.id !== user.id &&
          other.block === null &&
          currentMemberships(other).some(
            (theirs) => theirs.organization_id === membership.organization_id && theirs.role === 'owner',
          ),
      ),
  );

/** The delete dialog's check: the typed text is the account's email (any case, spaces around ignored). */
export const confirmationMatches = (email: string | null, typed: string): boolean =>
  email !== null && normalize(typed) !== '' && normalize(typed) === normalize(email);
