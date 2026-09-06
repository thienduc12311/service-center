import type { AssignmentStatus, OrgRole, PlanStatus } from '../types/database.js';

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'scheduler', 'member'];

/** Roles allowed to create plans, edit songs and schedule people. */
export const MANAGER_ROLES: readonly OrgRole[] = ['owner', 'admin', 'scheduler'];
export const ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin'];

export const canManage = (role: OrgRole | null | undefined): boolean =>
  role != null && MANAGER_ROLES.includes(role);

export const isAdmin = (role: OrgRole | null | undefined): boolean =>
  role != null && ADMIN_ROLES.includes(role);

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  unconfirmed: 'Awaiting reply',
  confirmed: 'Confirmed',
  declined: 'Declined',
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

/** Chromatic scale, sharps then the flat spellings used for transposition. */
export const SHARP_KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const MUSICAL_KEYS = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bbm', 'Bm',
] as const;

export const STORAGE_BUCKETS = {
  attachments: 'attachments',
  chordSheets: 'chord-sheets',
  organizationLogos: 'organization-logos',
  songbooks: 'songbooks',
} as const;
