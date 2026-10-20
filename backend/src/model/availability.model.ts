import {
  availabilityFreshness,
  type AvailabilityAudienceMember,
  type AvailabilityRequestRecipient,
  type AvailabilityRequestRow,
  type AvailabilityRequestSummary,
  type AvailabilityReviewKind,
  type AvailabilityReviewStatus,
  type CombinedScheduleItem,
  type DelegatedScheduleEntry,
  type DelegatedScheduleTime,
  type DelegationDirection,
  type DelegationSummary,
  type PersonAvailabilityReviewRow,
  type PreferenceWarning,
  type PreferenceWarningCode,
  type PreferenceWarningParams,
  type SchedulingFrequency,
  type ScheduleDelegationRow,
} from '@service-center/shared';

/** A roster name, as the people table stores it. */
export interface PersonNameRow {
  id: string;
  first_name: string;
  last_name: string | null;
}

export const personName = (row: Pick<PersonNameRow, 'first_name' | 'last_name'> | null | undefined): string =>
  row ? [row.first_name, row.last_name].filter(Boolean).join(' ') : 'Someone';

export const toReviewStatus = (
  personId: string,
  row: Pick<PersonAvailabilityReviewRow, 'reviewed_at' | 'kind'> | null,
  now: Date = new Date(),
): AvailabilityReviewStatus => ({
  person_id: personId,
  reviewed_at: row?.reviewed_at ?? null,
  kind: row?.kind ?? null,
  freshness: availabilityFreshness(row?.reviewed_at, { now }),
});

/** `preview_availability_request` output. */
export interface AudienceRpcRow {
  person_id: string;
  first_name: string;
  last_name: string | null;
  has_login: boolean;
  has_email: boolean;
  reviewed_at: string | null;
  review_kind: AvailabilityReviewKind | null;
}

export const toAudienceMember = (row: AudienceRpcRow, now: Date = new Date()): AvailabilityAudienceMember => ({
  ...row,
  freshness: availabilityFreshness(row.reviewed_at, { now }),
});

export const toRequestSummary = (
  row: AvailabilityRequestRow,
  teamName: string | null,
  respondedCount: number,
): AvailabilityRequestSummary => ({ ...row, team_name: teamName, responded_count: respondedCount });

export interface RecipientWithPerson {
  person_id: string;
  responded_at: string | null;
  response_kind: AvailabilityReviewKind | null;
  person: Pick<PersonNameRow, 'first_name' | 'last_name'> | null;
}

/**
 * Freshness is judged against this request: a review from before it was
 * sent does not count as answering it.
 */
export const toRequestRecipient = (
  row: RecipientWithPerson,
  review: Pick<PersonAvailabilityReviewRow, 'reviewed_at'> | null,
  requestedAt: string,
  now: Date = new Date(),
): AvailabilityRequestRecipient => ({
  person_id: row.person_id,
  name: personName(row.person),
  responded_at: row.responded_at,
  response_kind: row.response_kind,
  reviewed_at: review?.reviewed_at ?? null,
  freshness: availabilityFreshness(review?.reviewed_at, { now, requestedAt }),
});

const WARNING_CODES: ReadonlySet<PreferenceWarningCode> = new Set<PreferenceWarningCode>([
  'frequency', 'monthly_max', 'avoided_date', 'avoided_week', 'outside_preferred_weeks',
  'outside_preferred_dates', 'time_not_preferred', 'availability_unknown', 'availability_stale', 'busy_elsewhere',
]);

/** `scheduling_preference_warnings` output, validated rather than trusted. */
export interface WarningRpcRow {
  person_id: string;
  code: string;
  detail: string;
  preference_team_id: string | null;
  /** Absent before the structured-notices migration. */
  params?: unknown;
}

const FREQUENCIES: ReadonlySet<SchedulingFrequency> = new Set<SchedulingFrequency>([
  'every_week', 'every_other_week', 'every_third_week', 'once_a_month',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const wholeNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** Keeps only the well-formed values a warning's wording needs. */
export const toPreferenceWarningParams = (value: unknown): PreferenceWarningParams => {
  if (!isRecord(value)) return {};
  const params: PreferenceWarningParams = {};
  if (typeof value.frequency === 'string' && FREQUENCIES.has(value.frequency as SchedulingFrequency)) {
    params.frequency = value.frequency as SchedulingFrequency;
  }
  const served = wholeNumber(value.served);
  const max = wholeNumber(value.max);
  const week = wholeNumber(value.week);
  if (served !== undefined) params.served = served;
  if (max !== undefined) params.max = max;
  if (week !== undefined) params.week = week;
  if (typeof value.reviewed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.reviewed_on)) params.reviewed_on = value.reviewed_on;
  return params;
};

export const toPreferenceWarnings = (rows: readonly WarningRpcRow[]): PreferenceWarning[] =>
  rows.flatMap((row) => WARNING_CODES.has(row.code as PreferenceWarningCode)
    ? [{
        person_id: row.person_id,
        code: row.code as PreferenceWarningCode,
        detail: row.detail,
        params: toPreferenceWarningParams(row.params),
        preference_team_id: row.preference_team_id,
      }]
    : []);

/** `cross_organization_busy` output: a bare interval, nothing else. */
export interface BusyRpcRow {
  person_id: string;
  starts_at: string;
  ends_at: string;
}

const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }): boolean =>
  new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);

/**
 * Generic "busy elsewhere" warnings for the requested times. No title,
 * organization or reason is available to include.
 */
export const busyElsewhereWarnings = (
  busy: readonly BusyRpcRow[],
  times: ReadonlyArray<{ starts_at: string; ends_at: string }>,
): PreferenceWarning[] => {
  const people = new Set(busy.filter((interval) => times.some((time) => overlaps(interval, time))).map((b) => b.person_id));
  return [...people].map((personId) => ({
    person_id: personId,
    code: 'busy_elsewhere',
    detail: 'Busy at this time in another organization',
    params: {},
    preference_team_id: null,
  }));
};

export interface DelegationWithPeople extends ScheduleDelegationRow {
  target: Pick<PersonNameRow, 'first_name' | 'last_name'> | null;
  delegate: Pick<PersonNameRow, 'first_name' | 'last_name'> | null;
}

export const toDelegationSummary = (
  row: DelegationWithPeople,
  myPersonId: string | null,
  now: Date = new Date(),
): DelegationSummary => {
  const direction: DelegationDirection = row.target_person_id === myPersonId ? 'given' : 'received';
  return {
    id: row.id,
    direction,
    target_person_id: row.target_person_id,
    target_name: personName(row.target),
    delegate_person_id: row.delegate_person_id,
    delegate_name: personName(row.delegate),
    can_respond: row.can_respond,
    can_view_schedule: row.can_view_schedule,
    can_manage_availability: row.can_manage_availability,
    can_signup: row.can_signup,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at) > now),
  };
};

/** `delegated_schedule` output; `times` arrives as JSON. */
export interface DelegatedScheduleRpcRow extends Omit<DelegatedScheduleEntry, 'times'> {
  times: unknown;
}

const isScheduleTime = (value: unknown): value is DelegatedScheduleTime =>
  typeof value === 'object' && value !== null
  && typeof (value as DelegatedScheduleTime).id === 'string'
  && typeof (value as DelegatedScheduleTime).starts_at === 'string'
  && typeof (value as DelegatedScheduleTime).ends_at === 'string';

export const toDelegatedEntry = (row: DelegatedScheduleRpcRow): DelegatedScheduleEntry => ({
  ...row,
  times: Array.isArray(row.times) ? row.times.filter(isScheduleTime) : [],
});

/** `my_organization_schedule` output. */
export interface OrganizationScheduleRpcRow {
  kind: CombinedScheduleItem['kind'];
  item_id: string;
  title: string;
  status: string | null;
  starts_at: string;
  ends_at: string;
  plan_id: string | null;
}

export const toCombinedItem = (row: OrganizationScheduleRpcRow): CombinedScheduleItem => ({
  kind: row.kind,
  item_id: row.item_id,
  title: row.title,
  status: row.status === 'unconfirmed' || row.status === 'confirmed' || row.status === 'declined' ? row.status : null,
  starts_at: row.starts_at,
  ends_at: row.ends_at,
  plan_id: row.plan_id,
});

/**
 * Deterministic UUID for one copied blockout, so retrying a copy with the
 * same key reuses MOB-006's create_blockout idempotency instead of
 * duplicating rows. Not a security token.
 */
export const copyIdempotencyUuid = (hexDigest: string): string => {
  const hex = hexDigest.slice(0, 32).padEnd(32, '0');
  const variant = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
