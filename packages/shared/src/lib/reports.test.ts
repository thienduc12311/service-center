import { describe, expect, it } from 'vitest';
import type {
  ReportAssignmentSource,
  ReportFiltersApplied,
  ReportPlanSource,
  ReportPersonSource,
} from '../types/reports.js';
import {
  buildAttendanceSheetRows,
  buildParticipationReport,
  buildPublicPlanProjection,
  buildRunTimesReport,
  buildScheduleReport,
  buildSongUsageReport,
  buildStaffingReport,
  escapeCsvCell,
  publicationState,
  publicationVisibleFrom,
  reportRangeInstants,
  reportToCsv,
  REPORT_DEFINITIONS,
} from './reports.js';

const filters = (overrides: Partial<ReportFiltersApplied> = {}): ReportFiltersApplied => ({
  from: '2026-11-01',
  to: '2026-11-30',
  timezone: 'America/Chicago',
  service_type_ids: [],
  team_ids: [],
  plan_statuses: ['published'],
  assignment_statuses: ['confirmed', 'unconfirmed', 'declined'],
  include_archived_people: true,
  include_rehearsals: false,
  ...overrides,
});

const plans: ReportPlanSource[] = [
  { id: 'p1', title: 'Sunday 1', service_date: '2026-11-08T15:00:00Z', status: 'published', service_type_id: 'st', service_type_name: 'Sunday' },
  { id: 'p2', title: 'Sunday 2', service_date: '2026-11-15T15:00:00Z', status: 'published', service_type_id: 'st', service_type_name: 'Sunday' },
  { id: 'p3', title: 'Draft', service_date: '2026-11-22T15:00:00Z', status: 'draft', service_type_id: 'st', service_type_name: 'Sunday' },
];

const people: ReportPersonSource[] = [
  { id: 'ana', name: 'Ana', archived: false },
  { id: 'ben', name: 'Ben', archived: true },
];

const a = (id: string, plan: string, person: string, team: string, position: string | null, status: ReportAssignmentSource['status']): ReportAssignmentSource => ({
  id,
  plan_id: plan,
  person_id: person,
  team_id: team,
  team_name: team === 'band' ? 'Band' : 'Hosts',
  position_name: position,
  status,
  released_at: '2026-11-01T00:00:00Z',
  time_ids: [`${plan}-service`, `${plan}-rehearsal`],
});

// Ana: two positions on p1 (Band keys + Hosts greeter), one on p2. Ben: one declined on p1, one on the draft.
const assignments: ReportAssignmentSource[] = [
  a('a1', 'p1', 'ana', 'band', 'Keys', 'confirmed'),
  a('a2', 'p1', 'ana', 'hosts', 'Greeter', 'unconfirmed'),
  a('a3', 'p2', 'ana', 'band', 'Keys', 'confirmed'),
  a('a4', 'p1', 'ben', 'band', 'Bass', 'declined'),
  a('a5', 'p3', 'ben', 'band', 'Bass', 'confirmed'),
];

describe('participation', () => {
  it('distinguishes assignments from person-plans and people', () => {
    const { rows, summary } = buildParticipationReport({ filters: filters(), plans, assignments, people, attendance: [] });
    const ana = rows.find((row) => row.person_id === 'ana')!;
    expect(ana.assignments).toBe(3);
    expect(ana.person_plans).toBe(2);
    expect(ana.confirmed).toBe(2);
    expect(ana.pending).toBe(1);
    expect(ana.teams).toEqual(['Band', 'Hosts']);
    // The draft plan is excluded unless selected.
    const ben = rows.find((row) => row.person_id === 'ben')!;
    expect(ben.assignments).toBe(1);
    expect(ben.declined).toBe(1);
    expect(ben.last_service_date).toBeNull();
    expect(summary).toMatchObject({ assignments: 4, people: 2, person_plans: 3 });
    const band = summary.teams.find((team) => team.team_id === 'band')!;
    expect(band).toMatchObject({ assignments: 3, people: 2, person_plans: 3 });
  });

  it('counts attendance once per person per time and never from confirmation', () => {
    const { rows } = buildParticipationReport({
      filters: filters(),
      plans,
      assignments,
      people,
      attendance: [
        { plan_id: 'p1', plan_time_id: 'p1-service', person_id: 'ana', status: 'absent', time_kind: 'service' },
        { plan_id: 'p1', plan_time_id: 'p1-service', person_id: 'ana', status: 'absent', time_kind: 'service' },
        { plan_id: 'p1', plan_time_id: 'p1-rehearsal', person_id: 'ana', status: 'present', time_kind: 'rehearsal' },
        { plan_id: 'p2', plan_time_id: 'p2-service', person_id: 'ana', status: 'present', time_kind: 'service' },
      ],
    });
    const ana = rows.find((row) => row.person_id === 'ana')!;
    // Confirmed on p1 but recorded absent: confirmation is not attendance.
    expect(ana).toMatchObject({ confirmed: 2, present: 1, absent: 1 });
    const withRehearsals = buildParticipationReport({
      filters: filters({ include_rehearsals: true }),
      plans,
      assignments,
      people,
      attendance: [{ plan_id: 'p1', plan_time_id: 'p1-rehearsal', person_id: 'ana', status: 'present', time_kind: 'rehearsal' }],
    });
    expect(withRehearsals.rows.find((row) => row.person_id === 'ana')!.present).toBe(1);
  });

  it('applies archive, team, status and draft filters', () => {
    expect(buildParticipationReport({ filters: filters({ include_archived_people: false }), plans, assignments, people, attendance: [] }).summary.people).toBe(1);
    expect(buildParticipationReport({ filters: filters({ team_ids: ['hosts'] }), plans, assignments, people, attendance: [] }).summary.assignments).toBe(1);
    expect(buildParticipationReport({ filters: filters({ assignment_statuses: ['confirmed'] }), plans, assignments, people, attendance: [] }).summary.assignments).toBe(2);
    expect(buildParticipationReport({ filters: filters({ plan_statuses: ['published', 'draft'] }), plans, assignments, people, attendance: [] }).summary.assignments).toBe(5);
  });
});

describe('staffing', () => {
  it('computes vacancies from needs minus confirmed and pending', () => {
    const { rows, summary } = buildStaffingReport({
      filters: filters(),
      plans,
      assignments,
      people,
      needs: [
        { plan_id: 'p1', team_id: 'band', team_name: 'Band', position_name: 'Bass', needed: 1 },
        { plan_id: 'p1', team_id: 'band', team_name: 'Band', position_name: 'Keys', needed: 2 },
      ],
    });
    const bass = rows.find((row) => row.plan_id === 'p1' && row.position_name === 'Bass')!;
    expect(bass).toMatchObject({ needed: 1, declined: 1, vacancies: 1 });
    const keys = rows.find((row) => row.plan_id === 'p1' && row.position_name === 'Keys')!;
    expect(keys).toMatchObject({ needed: 2, confirmed: 1, vacancies: 1 });
    expect(summary.vacancies).toBe(2);
    expect(summary.follow_ups.map((f) => [f.person_name, f.response])).toEqual([
      ['Ana', 'unconfirmed'],
      ['Ben', 'declined'],
    ]);
    // A status filter limits follow-ups, never the vacancy arithmetic.
    const pendingOnly = buildStaffingReport({ filters: filters({ assignment_statuses: ['unconfirmed'] }), plans, assignments, people, needs: [] });
    expect(pendingOnly.summary.follow_ups).toHaveLength(1);
    expect(pendingOnly.summary.confirmed).toBe(2);
  });
});

describe('song usage', () => {
  it('separates occurrences from distinct plans', () => {
    const { rows, summary } = buildSongUsageReport({
      filters: filters(),
      plans,
      items: [
        { plan_id: 'p1', item_id: 'i1', song_id: 's1', title: 'Opening', author: 'A', key: 'G' },
        { plan_id: 'p1', item_id: 'i2', song_id: 's1', title: 'Opening', author: 'A', key: 'A' },
        { plan_id: 'p2', item_id: 'i3', song_id: 's1', title: 'Opening', author: 'A', key: 'G' },
        { plan_id: 'p2', item_id: 'i4', song_id: 's2', title: 'Closing', author: null, key: null },
        { plan_id: 'p3', item_id: 'i5', song_id: 's2', title: 'Closing', author: null, key: null },
      ],
    });
    expect(rows[0]).toMatchObject({ song_id: 's1', occurrences: 3, plans: 2, keys: ['A', 'G'] });
    expect(rows[1]).toMatchObject({ song_id: 's2', occurrences: 1, plans: 1 });
    expect(summary).toEqual({ occurrences: 4, songs: 2, plans: 2 });
  });
});

describe('run times and schedule', () => {
  it('reports only the runs it is given (ended runs) with differences', () => {
    const { rows, summary } = buildRunTimesReport({
      filters: filters(),
      plans,
      runs: [
        { run_id: 'r1', plan_id: 'p1', time_name: '9am', time_starts_at: '2026-11-08T15:00:00Z', planned_seconds: 3600, actual_seconds: 3900, items: 10, items_over: 2, corrected: false },
        { run_id: 'r2', plan_id: 'p3', time_name: null, time_starts_at: '2026-11-22T15:00:00Z', planned_seconds: 3600, actual_seconds: 3000, items: 5, items_over: 0, corrected: false },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.difference_seconds).toBe(300);
    expect(summary.average_difference_seconds).toBe(300);
  });

  it('lists every request with its service times only by default', () => {
    const { rows, summary } = buildScheduleReport({
      filters: filters(),
      plans,
      assignments,
      people,
      times: [
        { id: 'p1-service', plan_id: 'p1', kind: 'service', name: '9am', starts_at: '2026-11-08T15:00:00Z' },
        { id: 'p1-rehearsal', plan_id: 'p1', kind: 'rehearsal', name: null, starts_at: '2026-11-06T00:00:00Z' },
      ],
    });
    expect(summary).toEqual({ plans: 2, assignments: 4, people: 2 });
    expect(rows.find((row) => row.plan_id === 'p1' && row.team_name === 'Band' && row.person_id === 'ana')!.times).toEqual(['9am']);
  });
});

describe('attendance sheet', () => {
  it('deduplicates a Person on two positions and ignores declined requests', () => {
    const { rows, counts } = buildAttendanceSheetRows(
      [
        { assignment_id: 'a1', person_id: 'ana', person_name: 'Ana', archived: false, team_id: 'band', team_name: 'Band', position_name: 'Keys', response: 'confirmed', can_mark: false },
        { assignment_id: 'a2', person_id: 'ana', person_name: 'Ana', archived: false, team_id: 'hosts', team_name: 'Hosts', position_name: 'Greeter', response: 'unconfirmed', can_mark: true },
        { assignment_id: 'a4', person_id: 'ben', person_name: 'Ben', archived: true, team_id: 'band', team_name: 'Band', position_name: 'Bass', response: 'declined', can_mark: true },
      ],
      [{ id: 'r1', person_id: 'ana', status: 'absent', revision: 2, marked_by_name: 'Jordan', marked_at: '2026-11-08T16:00:00Z', marked_team_id: 'hosts' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.roles).toHaveLength(2);
    expect(rows[0]!.mark_team_id).toBe('hosts');
    expect(counts).toEqual({ scheduled_people: 1, present: 0, absent: 1, unknown: 0, unmarked: 0 });
  });
});

describe('formats', () => {
  it('escapes spreadsheet formulas and quotes', () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('-2')).toBe("'-2");
    expect(escapeCsvCell('@cmd')).toBe("'@cmd");
    expect(escapeCsvCell(-2)).toBe('-2');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell(null)).toBe('');
  });

  it('writes filters, timezone, generation time and definitions above the same rows', () => {
    const built = buildSongUsageReport({ filters: filters(), plans, items: [{ plan_id: 'p1', item_id: 'i', song_id: 's', title: '=SUM(A1)', author: null, key: null }] });
    const csv = reportToCsv({
      kind: 'song_usage',
      title: 'Song usage',
      generated_at: '2026-11-30T12:00:00.000Z',
      filters: filters(),
      definitions: REPORT_DEFINITIONS.song_usage,
      scope_note: null,
      truncated: false,
      rows: built.rows,
    });
    expect(csv).toContain('Timezone,America/Chicago');
    expect(csv).toContain('Generated at (UTC),2026-11-30T12:00:00.000Z');
    expect(csv).toContain('Definition: Occurrences');
    expect(csv).toContain("'=SUM(A1),,1,1,,2026-11-08,2026-11-08");
  });

  it('resolves local report dates in the organization timezone', () => {
    expect(reportRangeInstants('2026-11-01', '2026-11-01', 'America/Chicago')).toEqual({
      start: '2026-11-01T05:00:00.000Z',
      end: '2026-11-02T06:00:00.000Z',
    });
  });
});

describe('publication', () => {
  const window = {
    publish_mode: 'service_day' as const,
    published_at: '2026-11-01T00:00:00.000Z',
    revoked_at: null,
    plan_status: 'published',
    service_date: '2026-11-08T15:00:00.000Z',
    timezone: 'America/Chicago',
  };

  it('opens a service-day publication at local midnight and honours revocation and drafts', () => {
    expect(publicationVisibleFrom(window)).toBe('2026-11-08T06:00:00.000Z');
    expect(publicationState(window, Date.parse('2026-11-08T05:59:00Z'))).toBe('scheduled');
    expect(publicationState(window, Date.parse('2026-11-08T06:00:00Z'))).toBe('live');
    expect(publicationState({ ...window, revoked_at: '2026-11-02T00:00:00Z' }, Date.parse('2026-11-09T00:00:00Z'))).toBe('revoked');
    expect(publicationState({ ...window, plan_status: 'draft' }, Date.parse('2026-11-09T00:00:00Z'))).toBe('ineligible');
  });

  it('projects only the chosen fields and never rehearsals', () => {
    const source = {
      organization_name: 'Grace',
      timezone: 'America/Chicago',
      plan: { title: 'Sunday', service_date: '2026-11-08T15:00:00Z', status: 'published' as const, location: 'Main hall', service_type_name: 'Sunday AM' },
      times: [
        { kind: 'rehearsal' as const, name: 'Run-through', starts_at: '2026-11-07T00:00:00Z', ends_at: '2026-11-07T01:00:00Z' },
        { kind: 'service' as const, name: '9am', starts_at: '2026-11-08T15:00:00Z', ends_at: '2026-11-08T16:00:00Z' },
      ],
      items: [
        { item_type: 'header' as const, title: 'Worship', length_seconds: 0, song: null, key: null },
        { item_type: 'song' as const, title: 'Opening', length_seconds: 300, song: { title: 'Opening', author: 'A' }, key: 'G' },
      ],
    };
    const minimal = buildPublicPlanProjection(source, ['title', 'times']);
    expect(minimal).toEqual({
      organization: 'Grace',
      timezone: 'America/Chicago',
      title: 'Sunday',
      times: [{ name: '9am', starts_at: '2026-11-08T15:00:00Z', ends_at: '2026-11-08T16:00:00Z' }],
    });
    const order = buildPublicPlanProjection(source, ['order']);
    expect(order.items?.[1]).toEqual({ kind: 'song', title: 'Song' });
    const full = buildPublicPlanProjection(source, ['order', 'songs', 'song_keys', 'item_lengths']);
    expect(full.items?.[1]).toEqual({ kind: 'song', title: 'Opening', length_seconds: 300, song: { title: 'Opening', key: 'G' } });
    expect(JSON.stringify(full)).not.toContain('Main hall');
  });
});
