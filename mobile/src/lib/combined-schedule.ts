import {
  addDays,
  combinedScheduleQuerySchema,
  copyAvailabilitySchema,
  type BlockoutRow,
  type CombinedSchedule,
  type CombinedScheduleItem,
  type CombinedScheduleQuery,
  type CopyAvailabilityRequest,
  type CurrentUser,
  type ScheduleSettingsInput,
  type UserScheduleSettingsRow,
} from '@service-center/shared';

/**
 * MOB-032: F03 Pass D on its existing contracts — `scheduleSettings`,
 * `updateScheduleSettings`, `combinedSchedule` and `copyAvailability`. The
 * combined view is the caller's own items, read by the server once per
 * organization with that organization's permissions; it never includes a
 * household member's schedule. Opening an item re-authorizes in its own
 * organization (switch, then the plan read) through the navigation intents.
 */

/** The website's window ("Next 30 days"); the server allows at most 92. */
export const COMBINED_WINDOW_DAYS = 30;

export const combinedScheduleWindow = (now: Date): CombinedScheduleQuery =>
  combinedScheduleQuerySchema.parse({ from: now.toISOString(), to: addDays(now, COMBINED_WINDOW_DAYS).toISOString() });

/** The server answers with defaults (off) before the person ever saved a choice. */
export const scheduleSettingsInput = (row: UserScheduleSettingsRow | undefined): ScheduleSettingsInput => ({
  combined_schedule: row?.combined_schedule ?? false,
  share_busy_across_orgs: row?.share_busy_across_orgs ?? false,
});

/** The title the server gives a blockout without a reason (website `UNAVAILABLE_TITLE`). */
export const UNAVAILABLE_TITLE = 'Unavailable';

export type CombinedTitle =
  | { kind: 'assignment'; title: string }
  | { kind: 'unavailable' }
  | { kind: 'unavailableWithTitle'; title: string };

export const combinedItemTitle = (item: Pick<CombinedScheduleItem, 'kind' | 'title'>): CombinedTitle =>
  item.kind !== 'blockout'
    ? { kind: 'assignment', title: item.title }
    : item.title !== UNAVAILABLE_TITLE
      ? { kind: 'unavailableWithTitle', title: item.title }
      : { kind: 'unavailable' };

/**
 * One organization's section. `stale` means the server read an organization
 * this device's account data does not list (it changed since sign-in): its
 * items are shown but cannot be opened until the account is refreshed.
 * `revoked` is the reverse — listed here, no longer an active membership on
 * the server — and is shown as such rather than silently dropped.
 */
export type CombinedSectionState = 'ok' | 'error' | 'stale' | 'revoked';

export interface CombinedSectionRow {
  key: string;
  item: CombinedScheduleItem;
  title: CombinedTitle;
  awaitingAnswer: boolean;
  /** A plan to open in this organization (assignments only, never for stale/revoked sections). */
  planId: string | null;
}

export interface CombinedSection {
  organizationId: string;
  organizationName: string;
  /** The organization's IANA zone, from the signed-in account; null when unknown here. */
  timeZone: string | null;
  isActive: boolean;
  state: CombinedSectionState;
  error: string | null;
  rows: CombinedSectionRow[];
}

export const combinedSections = (
  schedule: CombinedSchedule,
  user: Pick<CurrentUser, 'memberships'>,
  activeOrganizationId: string | null,
): CombinedSection[] => {
  const known = new Map(user.memberships.map((membership) => [membership.organization.id, membership.organization]));
  const sections = schedule.organizations.map((org): CombinedSection => {
    const organization = known.get(org.organization_id);
    const state: CombinedSectionState = org.status === 'error' ? 'error' : organization ? 'ok' : 'stale';
    return {
      organizationId: org.organization_id,
      organizationName: org.organization_name,
      timeZone: organization?.timezone ?? null,
      isActive: org.organization_id === activeOrganizationId,
      state,
      error: org.error,
      rows: [...org.items]
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((item) => ({
          key: `${item.kind}-${item.item_id}-${item.starts_at}`,
          item,
          title: combinedItemTitle(item),
          awaitingAnswer: item.status === 'unconfirmed',
          planId: state === 'ok' && item.kind === 'assignment' ? item.plan_id : null,
        })),
    };
  });
  const answered = new Set(schedule.organizations.map((org) => org.organization_id));
  const revoked = user.memberships
    .filter((membership) => !answered.has(membership.organization.id))
    .map(
      (membership): CombinedSection => ({
        organizationId: membership.organization.id,
        organizationName: membership.organization.name,
        timeZone: membership.organization.timezone ?? null,
        isActive: membership.organization.id === activeOrganizationId,
        state: 'revoked',
        error: null,
        rows: [],
      }),
    );
  return [...sections, ...revoked];
};

/** The organization's zone when it differs from the device's, so times read in their original context. */
export const timeZoneNote = (organizationZone: string | null, deviceZone: string): string | null =>
  organizationZone && organizationZone !== deviceZone ? organizationZone : null;

/** Copying is limited to one-off blockouts (the website's rule); series are managed per organization. */
export const copyableBlockouts = (blockouts: readonly BlockoutRow[]): BlockoutRow[] =>
  blockouts.filter((blockout) => !blockout.series_id);

/** Organizations to copy into: every other active membership. */
export const copyTargets = (user: Pick<CurrentUser, 'memberships'>, activeOrganizationId: string | null) =>
  user.memberships.filter((membership) => membership.organization.id !== activeOrganizationId);

/** The reviewed copy, validated by the shared schema; one key per reviewed selection, reused on retry. */
export const copyAvailabilityBody = (
  blockoutIds: readonly string[],
  targetOrganizationIds: readonly string[],
  includeReason: boolean,
  idempotencyKey: string,
): CopyAvailabilityRequest =>
  copyAvailabilitySchema.parse({
    blockout_ids: [...blockoutIds],
    target_organization_ids: [...targetOrganizationIds],
    include_reason: includeReason,
    idempotency_key: idempotencyKey,
  });

/** A selection identity: the key changes only when what is being copied changes. */
export const copySelectionSignature = (
  blockoutIds: readonly string[],
  targetOrganizationIds: readonly string[],
  includeReason: boolean,
): string => JSON.stringify([[...blockoutIds].sort(), [...targetOrganizationIds].sort(), includeReason]);
