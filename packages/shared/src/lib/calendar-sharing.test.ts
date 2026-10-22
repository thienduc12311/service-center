import { describe, expect, it } from 'vitest';
import type { CalendarLayerEvent, ReportExportSummary } from '../types/reports.js';
import { reportFiltersSchema } from '../schemas/reports.js';
import { calendarQuerySchema } from '../schemas/plan.js';
import {
  DEFAULT_CALENDAR_FILTERS,
  calendarLayerEventDays,
  calendarLayersRequestFor,
  calendarQueryFor,
  canRebuildReportExport,
  defaultReportFilters,
  personalFeedState,
  planReportFilters,
  reportExportErrorKey,
  reportExportStatusAt,
  reportExportsInProgress,
  toggleCalendarLayer,
  withCalendarTeam,
} from './calendar-sharing.js';

const range = { from: new Date(2026, 9, 1, 0, 0).toISOString(), to: new Date(2026, 9, 31, 23, 59).toISOString() };

describe('calendar filters (MOB-022, both clients)', () => {
  it('sends only what was chosen, so the server default (rehearsals included) applies', () => {
    expect(calendarQueryFor(DEFAULT_CALENDAR_FILTERS, range)).toEqual(range);
    const team = '11111111-1111-4111-8111-111111111111';
    const query = calendarQueryFor({ mine: true, teamId: team, layers: [] }, range);
    expect(query).toEqual({ ...range, mine: true, team_id: team });
    expect(calendarQuerySchema.parse(query)).toMatchObject({ mine: true, team_id: team, include_rehearsals: true });
  });

  it('fetches layers only for a chosen team, in display order and civil days', () => {
    expect(calendarLayersRequestFor({ mine: false, teamId: null, layers: ['birthdays'] }, range)).toBeNull();
    expect(calendarLayersRequestFor({ mine: false, teamId: 'team-1', layers: [] }, range)).toBeNull();
    expect(calendarLayersRequestFor({ mine: false, teamId: 'team-1', layers: ['birthdays', 'blockouts'] }, range)).toEqual({
      team_id: 'team-1',
      from: '2026-10-01',
      to: '2026-10-31',
      layers: ['blockouts', 'birthdays'],
    });
  });

  it('drops layers when the team is cleared and ignores layer toggles without a team', () => {
    const withTeam = toggleCalendarLayer(withCalendarTeam(DEFAULT_CALENDAR_FILTERS, 'team-1'), 'anniversaries');
    expect(withTeam.layers).toEqual(['anniversaries']);
    expect(toggleCalendarLayer(withTeam, 'blockouts').layers).toEqual(['blockouts', 'anniversaries']);
    expect(toggleCalendarLayer(withTeam, 'anniversaries').layers).toEqual([]);
    expect(withCalendarTeam(withTeam, null)).toEqual({ mine: false, teamId: null, layers: [] });
    expect(toggleCalendarLayer(DEFAULT_CALENDAR_FILTERS, 'blockouts')).toBe(DEFAULT_CALENDAR_FILTERS);
  });

  it('places all-day layer events on their date and timed blockouts on each day they touch', () => {
    const base: CalendarLayerEvent = {
      id: 'birthdays-p-2026-10-04',
      layer: 'birthdays',
      person_id: 'p',
      person_name: 'Riley',
      date: '2026-10-04',
      starts_at: null,
      ends_at: null,
      all_day: true,
    };
    expect(calendarLayerEventDays(base)).toEqual(['2026-10-04']);
    expect(
      calendarLayerEventDays({
        ...base,
        layer: 'blockouts',
        date: null,
        all_day: false,
        starts_at: new Date(2026, 9, 10, 9).toISOString(),
        ends_at: new Date(2026, 9, 12, 8).toISOString(),
      }),
    ).toEqual(['2026-10-10', '2026-10-11']);
    expect(calendarLayerEventDays({ ...base, date: null })).toEqual([]);
  });
});

describe('personal feed link state', () => {
  const link = { url: 'https://api.test/api/v1/calendar-feed/secret.ics', webcal_url: 'webcal://api.test/x', active: true };

  it('never claims a link before the status is read', () => {
    expect(personalFeedState(undefined, null)).toBe('loading');
  });

  it('offers creation when no link is active', () => {
    expect(personalFeedState({ url: null, webcal_url: null, active: false }, null)).toBe('none');
  });

  it('says a link exists without showing it (the server never returns it again)', () => {
    expect(personalFeedState({ url: null, webcal_url: null, active: true }, null)).toBe('active');
  });

  it('shows the link created on this screen', () => {
    expect(personalFeedState({ url: null, webcal_url: null, active: true }, link)).toBe('revealed');
    expect(personalFeedState(undefined, link)).toBe('revealed');
  });

  it('hides a link revoked elsewhere', () => {
    expect(personalFeedState({ url: null, webcal_url: null, active: false }, link)).toBe('none');
  });
});

describe('report filters and exports', () => {
  it('starts both clients on the same valid filters in the organization timezone', () => {
    // 2026-03-01 03:00 UTC is still 28 Feb in Los Angeles.
    const filters = defaultReportFilters(Date.UTC(2026, 2, 1, 3), 'America/Los_Angeles');
    expect(filters.from).toBe('2026-01-31');
    expect(filters.to).toBe('2026-03-28');
    expect(reportFiltersSchema.safeParse(filters).success).toBe(true);
  });

  it('narrows a report to one plan day and service type', () => {
    const base = defaultReportFilters(Date.UTC(2026, 9, 22), 'UTC');
    expect(planReportFilters({ service_date: '2026-10-25', service_type_id: 'st-1' }, base)).toMatchObject({
      from: '2026-10-25',
      to: '2026-10-25',
      service_type_ids: ['st-1'],
      plan_statuses: ['published'],
    });
    expect(planReportFilters({ service_date: '2026-10-25', service_type_id: null }, base).service_type_ids).toEqual([]);
  });

  const row = (status: ReportExportSummary['status'], expires_at: string | null = null): ReportExportSummary => ({
    id: 'e1',
    organization_id: 'o',
    requested_by: 'u',
    kind: 'schedule',
    filters: { from: '2026-10-01', to: '2026-10-31' },
    status,
    attempts: 1,
    next_attempt_at: '2026-10-22T00:00:00Z',
    error_code: null,
    row_count: null,
    size_bytes: null,
    generated_at: null,
    expires_at,
    created_at: '2026-10-22T00:00:00Z',
    updated_at: '2026-10-22T00:00:00Z',
  });

  it('polls only while an export is queued or building', () => {
    expect(reportExportsInProgress(undefined)).toBe(false);
    expect(reportExportsInProgress([row('ready'), row('failed')])).toBe(false);
    expect(reportExportsInProgress([row('ready'), row('queued')])).toBe(true);
    expect(reportExportsInProgress([row('running')])).toBe(true);
  });

  it('treats a ready file past its expiry as expired, and only failed/expired can be rebuilt', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(reportExportStatusAt(row('ready', '2026-10-23T00:00:00Z'), now)).toBe('ready');
    expect(reportExportStatusAt(row('ready', '2026-10-22T11:59:59Z'), now)).toBe('expired');
    expect(reportExportStatusAt(row('queued'), now)).toBe('queued');
    expect(canRebuildReportExport('expired')).toBe(true);
    expect(canRebuildReportExport('failed')).toBe(true);
    expect(canRebuildReportExport('ready')).toBe(false);
    expect(canRebuildReportExport('queued')).toBe(false);
  });

  it('maps recorded failure codes to their own message or a generic one', () => {
    expect(reportExportErrorKey(null)).toBeNull();
    expect(reportExportErrorKey('access_revoked')).toBe('access_revoked');
    expect(reportExportErrorKey('something_new')).toBe('other');
  });
});
