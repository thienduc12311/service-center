import type { AssignmentStatus, OrgRole, PlanRecurrence, PlanStatus } from '../types/database.js';
import type { TeamTemplate, TeamTemplateCategory } from '../types/domain.js';

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

// ------------------------------------------------------- service types ----

export const PLAN_RECURRENCE_LABELS: Record<PlanRecurrence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every other week',
  monthly: 'Monthly',
  occasionally: 'Occasionally',
};

/** Names the setup wizard suggests, so a new organization isn't staring at a blank field. */
export const SERVICE_TYPE_NAME_EXAMPLES: readonly string[] = [
  'Weekend Service',
  'Sunday Service',
  'Special Events',
  'Contemporary Service',
  'Traditional Service',
  'Celebrate Recovery',
  "Children's Ministry",
  'High School',
  'Middle School',
];

export const TEAM_TEMPLATE_CATEGORY_LABELS: Record<TeamTemplateCategory, string> = {
  music: 'Music',
  technical: 'Technical',
  kids: 'Kids',
  hospitality: 'Hospitality',
  other: 'Other',
};

/** Order the categories are shown in, left to right. */
export const TEAM_TEMPLATE_CATEGORIES: readonly TeamTemplateCategory[] = [
  'music',
  'technical',
  'kids',
  'hospitality',
  'other',
];

const TEAM_CATEGORY_COLORS: Record<TeamTemplateCategory, string> = {
  music: '#6366f1',
  technical: '#0ea5e9',
  kids: '#f59e0b',
  hospitality: '#10b981',
  other: '#64748b',
};

/** Every technical team schedules the same booth roles. */
const BOOTH_POSITIONS = [
  'Audio',
  'Camera',
  'Lights',
  'Lyrics',
  'Producer',
  'Sound',
  'Video Switcher',
] as const;

const KIDS_POSITIONS = ['Check-In', 'Large Group Leader', 'Small Group Leader', 'Helper'] as const;

const template = (
  category: TeamTemplateCategory,
  name: string,
  positions: readonly string[],
): TeamTemplate => ({ category, name, color: TEAM_CATEGORY_COLORS[category], positions });

/**
 * The ready-made teams offered by the last step of the service type wizard.
 * Picking one creates a real team with these positions — all of them editable
 * afterwards, so the list only has to be a good starting point.
 */
export const COMMON_TEAM_TEMPLATES: readonly TeamTemplate[] = [
  template('music', 'Band', ['Acoustic Guitar', 'Bass Guitar', 'Drums', 'Electric Guitar', 'Keys', 'Piano']),
  template('music', 'Choir', ['Choir Director', 'Soprano', 'Alto', 'Tenor', 'Bass']),
  template('music', 'Orchestra', ['Cello', 'Flute', 'Percussion', 'Trumpet', 'Violin']),
  template('music', 'Praise Team', ['Worship Leader', 'Lead Vocal', 'Harmony Vocal']),
  template('music', 'Vocals', ['Lead Vocal', 'Soprano', 'Alto', 'Tenor']),

  template('technical', 'Audio/Visual', BOOTH_POSITIONS),
  template('technical', 'Media', BOOTH_POSITIONS),
  template('technical', 'Production', BOOTH_POSITIONS),
  template('technical', 'Tech', BOOTH_POSITIONS),
  template('technical', 'Video', ['Camera', 'Video Director', 'Video Switcher']),

  template('kids', 'Nursery', KIDS_POSITIONS),
  template('kids', 'Toddlers', KIDS_POSITIONS),
  template('kids', 'Pre-K', KIDS_POSITIONS),
  template('kids', 'K-1st', KIDS_POSITIONS),
  template('kids', '2nd-3rd', KIDS_POSITIONS),
  template('kids', 'Preteen', KIDS_POSITIONS),
  template('kids', 'Middle School', KIDS_POSITIONS),
  template('kids', 'High School', KIDS_POSITIONS),

  template('hospitality', 'First Impressions', ['Greeter', 'Host']),
  template('hospitality', 'Greeters', ['Greeter']),
  template('hospitality', 'Guest Services', ['Greeter', 'Parking', 'Set Up', 'Tear Down', 'Usher']),
  template('hospitality', 'Hospitality', ['Host', 'Set Up', 'Tear Down']),
  template('hospitality', 'Ushers', ['Usher', 'Offering']),
  template('hospitality', 'Welcome Team', ['Greeter', 'Host']),

  template('other', 'Cafe', ['Setup', 'Coffee', 'Cleanup']),
  template('other', 'Leadership', ['Host', 'Speaker']),
  template('other', 'Parking', ['Parking']),
  template('other', 'Security', ['Security']),
  template('other', 'Speaking Team', ['Announcements', 'Speaker']),
];
