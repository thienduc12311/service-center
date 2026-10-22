/**
 * MOB-022: calendar filters, opt-in layers, the personal subscription link and
 * report exports, kept the same on the website and the phone. Every helper
 * builds the exact request an existing API method takes, or reads its
 * response; none of them adds a field to the wire contract.
 */
import type { CalendarFeedTokenResponse } from '../types/domain.js';
import type {
  CalendarLayer,
  CalendarLayerEvent,
  ReportExportStatus,
  ReportExportSummary,
} from '../types/reports.js';
import type { CalendarLayersRequest, ReportFiltersRequest } from '../schemas/reports.js';
import { addLocalDays, localDateAt } from './timezone.js';
import { toISODate } from './dates.js';

// ================================================================= calendar

/** Every opt-in layer, in display order. */
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ['blockouts', 'birthdays', 'anniversaries'];

/** What the person chose on either calendar screen. */
export interface CalendarFilters {
  /** Only the times my released requests cover. */
  mine: boolean;
  /** Plans with a released request on this team; null = every team. */
  teamId: string | null;
  /** Opt-in layers; they apply only with a team chosen. */
  layers: readonly CalendarLayer[];
}

/** A window of instants (ISO strings) a calendar screen shows. */
export interface CalendarRange {
  from: string;
  to: string;
}

/** The `calendar()` query: absent keys mean the server default (rehearsals included). */
export interface CalendarQueryRequest {
  from: string;
  to: string;
  mine?: true;
  team_id?: string;
}

export const DEFAULT_CALENDAR_FILTERS: CalendarFilters = { mine: false, teamId: null, layers: [] };

export const calendarQueryFor = (filters: CalendarFilters, range: CalendarRange): CalendarQueryRequest => ({
  from: range.from,
  to: range.to,
  ...(filters.mine ? { mine: true as const } : {}),
  ...(filters.teamId ? { team_id: filters.teamId } : {}),
});

/**
 * The `calendarLayers()` query, or null when nothing should be fetched (no
 * team or no layer). Dates are the viewer's civil days, like the grid.
 */
export const calendarLayersRequestFor = (
  filters: CalendarFilters,
  range: CalendarRange,
): CalendarLayersRequest | null => {
  if (!filters.teamId || filters.layers.length === 0) return null;
  return {
    team_id: filters.teamId,
    from: toISODate(range.from),
    to: toISODate(range.to),
    layers: CALENDAR_LAYERS.filter((layer) => filters.layers.includes(layer)),
  };
};

/** Choosing another team (or none) keeps the layers only while a team is chosen. */
export const withCalendarTeam = (filters: CalendarFilters, teamId: string | null): CalendarFilters => ({
  ...filters,
  teamId,
  layers: teamId ? filters.layers : [],
});

export const toggleCalendarLayer = (filters: CalendarFilters, layer: CalendarLayer): CalendarFilters =>
  filters.teamId
    ? {
        ...filters,
        layers: filters.layers.includes(layer)
          ? filters.layers.filter((value) => value !== layer)
          : CALENDAR_LAYERS.filter((value) => value === layer || filters.layers.includes(value)),
      }
    : filters;

/** Civil days a layer event covers (all-day: its date; timed: each day it touches, at most 62). */
export const calendarLayerEventDays = (event: CalendarLayerEvent): string[] => {
  if (event.date) return [event.date];
  if (!event.starts_at || !event.ends_at) return [];
  const days: string[] = [];
  const end = new Date(event.ends_at).getTime();
  for (let at = new Date(event.starts_at).getTime(); at < end && days.length < 62; at += 86_400_000) {
    const day = toISODate(at);
    if (days.at(-1) !== day) days.push(day);
  }
  return days;
};

// ======================================================== personal feed link

/**
 * - `loading`: the status has not been read yet.
 * - `none`: no active link; creating one is safe.
 * - `active`: a link exists but the server never shows it again; a new link
 *   replaces it (existing subscriptions stop updating).
 * - `revealed`: the link created just now, held only in memory on this screen.
 */
export type PersonalFeedState = 'loading' | 'none' | 'active' | 'revealed';

/**
 * `GET /me/calendar-feed` returns `active` without a URL; only the rotate
 * response carries one. A revealed link is shown only while the server still
 * says a link is active (another device revoking it hides it here).
 */
export const personalFeedState = (
  status: CalendarFeedTokenResponse | undefined,
  revealed: CalendarFeedTokenResponse | null,
): PersonalFeedState => {
  if (!status) return revealed?.url ? 'revealed' : 'loading';
  if (!status.active) return 'none';
  return revealed?.url ? 'revealed' : 'active';
};

// ================================================================== reports

/** The website's starting filters: four weeks either side of today, organization timezone. */
export const defaultReportFilters = (now: number, timeZone: string): ReportFiltersRequest => {
  const today = localDateAt(now, timeZone);
  return {
    from: addLocalDays(today, -28),
    to: addLocalDays(today, 28),
    plan_statuses: ['published'],
    assignment_statuses: ['confirmed', 'unconfirmed', 'declined'],
    include_archived_people: true,
    include_rehearsals: false,
  };
};

/** Filters for one plan's day and service type (the report may list other plans that match). */
export const planReportFilters = (
  plan: { service_date: string; service_type_id: string | null },
  base: ReportFiltersRequest,
): ReportFiltersRequest => ({
  ...base,
  from: plan.service_date,
  to: plan.service_date,
  service_type_ids: plan.service_type_id ? [plan.service_type_id] : [],
});

/** Failure codes a queued export can record (`report_exports.error_code`). */
export type ReportExportErrorCode = 'access_revoked' | 'invalid_filters' | 'storage_failed' | 'generation_failed';
export const REPORT_EXPORT_ERROR_CODES: readonly ReportExportErrorCode[] = [
  'access_revoked',
  'invalid_filters',
  'storage_failed',
  'generation_failed',
];

/** A recorded code with its own message, or `other`. */
export const reportExportErrorKey = (code: string | null): ReportExportErrorCode | 'other' | null => {
  if (!code) return null;
  return (REPORT_EXPORT_ERROR_CODES as readonly string[]).includes(code) ? (code as ReportExportErrorCode) : 'other';
};

/** Whether any export is still being built (lists poll only then). */
export const reportExportsInProgress = (rows: readonly ReportExportSummary[] | undefined): boolean =>
  Boolean(rows?.some((row) => row.status === 'queued' || row.status === 'running'));

/**
 * The status to show and act on now. A `ready` export whose file has passed
 * `expires_at` is expired even before the worker records it: the server would
 * refuse the download.
 */
export const reportExportStatusAt = (row: ReportExportSummary, now: number): ReportExportStatus =>
  row.status === 'ready' && row.expires_at && new Date(row.expires_at).getTime() <= now ? 'expired' : row.status;

/** Only failed or expired exports can be built again (`retry_report_export`). */
export const canRebuildReportExport = (status: ReportExportStatus): boolean =>
  status === 'failed' || status === 'expired';
