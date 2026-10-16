import type { AccessCapability, AccessScopeType } from '../types/database.js';
import type { CapabilityDenial, EffectiveAccess, EffectiveAccessEntry } from '../types/domain.js';

export const ACCESS_CAPABILITIES: readonly AccessCapability[] = [
  'plans.edit',
  'scheduling.manage',
  'teams.manage',
  'people.view_private',
  'people.manage',
  'songs.manage',
  'media.manage',
];

export const ACCESS_CAPABILITY_LABELS: Record<AccessCapability, string> = {
  'plans.edit': 'Edit plans',
  'scheduling.manage': 'Schedule people',
  'teams.manage': 'Manage teams',
  'people.view_private': 'See private person details',
  'people.manage': 'Manage people',
  'songs.manage': 'Manage songs',
  'media.manage': 'Manage media',
};

export const ACCESS_CAPABILITY_DESCRIPTIONS: Record<AccessCapability, string> = {
  'plans.edit': 'Create plans, edit their order, times, notes and needed positions.',
  'scheduling.manage': 'Schedule, prepare, release and remind people; see blockouts and decline reasons.',
  'teams.manage': 'Edit team settings, positions and who is on the team.',
  'people.view_private': 'Read contact, address and personal details of people.',
  'people.manage': 'Add and edit people in the directory.',
  'songs.manage': 'Edit the song library, arrangements and song books.',
  'media.manage': 'Upload and remove attachments.',
};

/**
 * Which scopes each capability can be granted at. Mirrors the
 * `access_grants_capability_scope` database constraint; library and directory
 * capabilities are organization-wide only.
 */
export const CAPABILITY_SCOPES: Record<AccessCapability, readonly AccessScopeType[]> = {
  'plans.edit': ['organization', 'folder', 'service_type'],
  'scheduling.manage': ['organization', 'folder', 'service_type', 'team'],
  'teams.manage': ['organization', 'folder', 'service_type', 'team'],
  'people.view_private': ['organization'],
  'people.manage': ['organization'],
  'songs.manage': ['organization'],
  'media.manage': ['organization'],
};

export const capabilitiesForScope = (scope: AccessScopeType): AccessCapability[] =>
  ACCESS_CAPABILITIES.filter((capability) => CAPABILITY_SCOPES[capability].includes(scope));

export const ACCESS_DENIAL_LABELS: Record<CapabilityDenial, string> = {
  not_a_member: 'Not a member of this organization.',
  membership_inactive: 'Their membership is inactive.',
  scoped_scheduler_without_grant: 'A scoped scheduler with no grant for this.',
  grant_outside_scope: 'They have this permission, but for a different service type or team.',
  no_matching_grant: 'No role or grant gives this permission.',
};

export const describeAccessSource = (source: EffectiveAccessEntry['source']): string => {
  switch (source) {
    case 'role:owner':
      return 'Owner';
    case 'role:admin':
      return 'Administrator';
    case 'role:scheduler_legacy':
      return 'Scheduler (organization-wide)';
    case 'grant:folder':
      return 'Folder grant';
    default:
      return 'Grant';
  }
};

/** The resource an action is about. Omitted fields mean "not scoped to one". */
export interface AccessTarget {
  serviceTypeId?: string | null;
  teamId?: string | null;
}

/**
 * Same rule as the database's `private.capability_for`, applied to the
 * effective rows the server returned (folder grants arrive expanded to
 * service types). For showing and hiding controls only — the server and RLS
 * decide every request.
 */
export const canAccess = (
  access: EffectiveAccess | null | undefined,
  capability: AccessCapability,
  target: AccessTarget = {},
): boolean =>
  Boolean(
    access?.entries.some(
      (entry) =>
        entry.capability === capability &&
        (entry.scope_type === 'organization' ||
          (entry.scope_type === 'service_type' && target.serviceTypeId != null && entry.scope_id === target.serviceTypeId) ||
          (entry.scope_type === 'team' && target.teamId != null && entry.scope_id === target.teamId)),
    ),
  );

/** Holds the capability at some scope (e.g. may open the scheduler at all). */
export const canAccessAnywhere = (
  access: EffectiveAccess | null | undefined,
  capability: AccessCapability,
): boolean => Boolean(access?.entries.some((entry) => entry.capability === capability));

/** Mirrors `can_manage_org`: some planning, scheduling or team capability. */
export const isLeader = (access: EffectiveAccess | null | undefined): boolean =>
  canAccessAnywhere(access, 'plans.edit') ||
  canAccessAnywhere(access, 'scheduling.manage') ||
  canAccessAnywhere(access, 'teams.manage');

/** Service types and teams a member holds a capability for, by explicit scope. */
export const scopedIds = (
  access: EffectiveAccess | null | undefined,
  capability: AccessCapability,
  scope: Extract<AccessScopeType, 'service_type' | 'team'>,
): string[] =>
  [
    ...new Set(
      (access?.entries ?? [])
        .filter((entry) => entry.capability === capability && entry.scope_type === scope && entry.scope_id)
        .map((entry) => entry.scope_id as string),
    ),
  ];
