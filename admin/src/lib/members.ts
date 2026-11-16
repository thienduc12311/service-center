import type { AdminOrganizationMember, OrgRole } from '@service-center/shared';

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  scheduler: 'Scheduler',
  member: 'Member',
};

export type MemberStatus = AdminOrganizationMember['status'];

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  inactive: 'Inactive',
  suspended: 'Suspended',
};

const ROLE_ORDER: Record<OrgRole, number> = { owner: 0, admin: 1, scheduler: 2, member: 3 };

/** Owners first, then by role, then by name or email. */
export const sortMembers = (members: readonly AdminOrganizationMember[]): AdminOrganizationMember[] =>
  [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '', 'en', { sensitivity: 'base' }),
  );
