import type {
  AdminChurchApplication,
  ChurchApplication,
  ChurchApplicationStatus,
  SubmitChurchApplicationRequest,
  UpdateChurchApplicationRequest,
} from '@service-center/shared';

export const APPLICATION_STATUSES: readonly ChurchApplicationStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];

export const APPLICATION_STATUS_LABELS: Record<ChurchApplicationStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const isApplicationStatus = (value: string | null): value is ChurchApplicationStatus =>
  value !== null && (APPLICATION_STATUSES as readonly string[]).includes(value);

/** "Atlanta, GA, United States". */
export const applicationLocation = (application: Pick<ChurchApplication, 'city' | 'state_province' | 'country'>): string =>
  [application.city, application.state_province, application.country].filter((part) => part && part.trim()).join(', ');

type ApplicationField = keyof SubmitChurchApplicationRequest;

const APPLICATION_FIELDS: readonly ApplicationField[] = [
  'church_name',
  'leader_name',
  'contact_phone',
  'website',
  'address_line1',
  'address_line2',
  'city',
  'state_province',
  'postal_code',
  'country',
  'expected_member_count',
  'timezone',
  'note',
];

/**
 * Only the fields the admin actually changed, so the audit log's
 * `application.edited` names the right ones. Empty when nothing changed.
 */
export const changedApplicationFields = (
  original: ChurchApplication,
  edited: SubmitChurchApplicationRequest,
): UpdateChurchApplicationRequest => {
  const changes: UpdateChurchApplicationRequest = {};
  for (const field of APPLICATION_FIELDS) {
    const next = edited[field] ?? null;
    if (next !== original[field]) Object.assign(changes, { [field]: next });
  }
  return changes;
};

/** The website as a link target: a bare domain gets `https://`. */
export const websiteHref = (website: string): string =>
  /^https?:\/\//i.test(website) ? website : `https://${website}`;

/** Newest first, except pending, which reads in order of arrival (oldest first). */
export const sortApplications = (
  applications: readonly AdminChurchApplication[],
  status: ChurchApplicationStatus,
): AdminChurchApplication[] => {
  const sign = status === 'pending' ? 1 : -1;
  return [...applications].sort((a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) * sign);
};
