/**
 * F16 — the one definition of every operational metric.
 *
 * Builders are pure: the server loads already-authorized, already-scoped rows
 * and every format (screen, print, CSV, queued export) is produced from the
 * same builder output, so they reconcile by construction.
 *
 * Counting rules (also returned as `definitions` with every report):
 * - An *assignment* is one request record. A Person on two positions of one
 *   plan is 2 assignments but 1 *person-plan* participation.
 * - *People* are distinct Person ids.
 * - Confirmation is planned participation, never attendance. Attendance
 *   counts distinct (Person, plan time) records of each status.
 * - A song twice in one plan is 2 *occurrences* and 1 *plan*.
 * - Actual timing uses ended (completed) Live runs only.
 */
import type { AssignmentStatus } from '../types/database.js';
import type {
  AttendanceCounts,
  AttendanceSheetRole,
  AttendanceSheetRow,
  AttendanceRecordRow,
  ParticipationReportRow,
  ParticipationSummary,
  ParticipationTeamTotal,
  PublicPlanField,
  PublicPlanItem,
  PublicPlanProjection,
  PublicPlanSource,
  PublicationState,
  PublishMode,
  ReportAssignmentSource,
  ReportAttendanceSource,
  ReportFiltersApplied,
  ReportKind,
  ReportMetricDefinition,
  ReportNeedSource,
  ReportPersonSource,
  ReportPlanSource,
  ReportRunSource,
  ReportSongItemSource,
  ReportTimeSource,
  RunTimesReportRow,
  RunTimesSummary,
  ScheduleReportRow,
  ScheduleSummary,
  SongUsageReportRow,
  SongUsageSummary,
  StaffingFollowUp,
  StaffingReportRow,
  StaffingSummary,
} from '../types/reports.js';
import { addLocalDays, localDateAt, possibleInstantsForLocalDateTime } from './timezone.js';

/** Most rows any one report returns on screen / synchronously. */
export const REPORT_ROW_LIMIT = 2000;
/** Most plans one report reads. */
export const REPORT_PLAN_LIMIT = 500;
/** Download links for a finished export last this long. */
export const REPORT_EXPORT_URL_TTL_SECONDS = 300;
/** A finished export file is kept this long, then deleted. */
export const REPORT_EXPORT_RETENTION_HOURS = 24;
export const REPORT_EXPORT_MAX_ATTEMPTS = 3;

export const REPORT_TITLES: Record<ReportKind, string> = {
  staffing: 'Staffing and follow-up',
  participation: 'Participation and response history',
  song_usage: 'Song usage',
  run_times: 'Actual run times',
  schedule: 'Multi-plan schedule',
};

export const UNPOSITIONED_LABEL = 'No position';

const DEFINITIONS: Record<string, ReportMetricDefinition> = {
  needed: { key: 'needed', label: 'Needed', definition: 'People the plan asks for in that position (plan position needs).' },
  confirmed: { key: 'confirmed', label: 'Confirmed', definition: 'Released requests the person accepted. Planned participation, not attendance.' },
  pending: { key: 'pending', label: 'Pending', definition: 'Released requests not yet answered.' },
  declined: { key: 'declined', label: 'Declined', definition: 'Released requests the person declined.' },
  vacancies: { key: 'vacancies', label: 'Vacancies', definition: 'Needed minus (confirmed + pending), never below zero. Prepared (unreleased) requests never fill a need here.' },
  assignments: { key: 'assignments', label: 'Assignments', definition: 'Request records. One person on two positions of one plan counts 2.' },
  person_plans: { key: 'person_plans', label: 'Person-plans', definition: 'Distinct (person, plan) pairs. One person on two positions of one plan counts 1.' },
  people: { key: 'people', label: 'People', definition: 'Distinct people.' },
  present: { key: 'present', label: 'Present', definition: 'Distinct plan times with an attendance record of "present" — what actually happened, recorded by a leader.' },
  absent: { key: 'absent', label: 'Absent', definition: 'Distinct plan times with an attendance record of "absent".' },
  unknown: { key: 'unknown', label: 'Unknown', definition: 'Distinct plan times recorded as "unknown". Times with no record are not counted.' },
  occurrences: { key: 'occurrences', label: 'Occurrences', definition: 'Times a song appears in plan orders. Twice in one plan counts 2.' },
  plans: { key: 'plans', label: 'Plans', definition: 'Distinct plans. A song twice in one plan counts 1.' },
  planned: { key: 'planned_seconds', label: 'Planned', definition: 'Sum of item lengths in the order snapshot the run pinned.' },
  actual: { key: 'actual_seconds', label: 'Actual', definition: 'Recorded start to end of an ended Live run, after audited corrections. Runs not ended are excluded.' },
  difference: { key: 'difference_seconds', label: 'Difference', definition: 'Actual minus planned (positive = ran long).' },
  response: { key: 'response', label: 'Response', definition: 'The request\'s answer. Planned participation, not attendance.' },
};

export const REPORT_DEFINITIONS: Record<ReportKind, ReportMetricDefinition[]> = {
  staffing: [DEFINITIONS.needed!, DEFINITIONS.confirmed!, DEFINITIONS.pending!, DEFINITIONS.declined!, DEFINITIONS.vacancies!],
  participation: [
    DEFINITIONS.assignments!,
    DEFINITIONS.person_plans!,
    DEFINITIONS.people!,
    DEFINITIONS.confirmed!,
    DEFINITIONS.pending!,
    DEFINITIONS.declined!,
    DEFINITIONS.present!,
    DEFINITIONS.absent!,
    DEFINITIONS.unknown!,
  ],
  song_usage: [DEFINITIONS.occurrences!, DEFINITIONS.plans!],
  run_times: [DEFINITIONS.planned!, DEFINITIONS.actual!, DEFINITIONS.difference!],
  schedule: [DEFINITIONS.assignments!, DEFINITIONS.people!, DEFINITIONS.response!],
};

// ==================================================================== range

export interface ReportRangeInstants {
  /** Start of `from` in the organization's timezone (inclusive). */
  start: string;
  /** Start of the day after `to` (exclusive). */
  end: string;
}

const startOfLocalDay = (date: string, timeZone: string): string => {
  const matches = possibleInstantsForLocalDateTime(date, '00:00', timeZone);
  if (matches[0]) return matches[0].instant;
  // Midnight skipped by DST: the day starts at the first existing minute.
  const later = possibleInstantsForLocalDateTime(date, '01:00', timeZone);
  if (!later[0]) throw new Error(`Cannot resolve the start of ${date} in ${timeZone}`);
  return later[0].instant;
};

/** Local-date range → half-open UTC instants, in the organization's timezone. */
export const reportRangeInstants = (from: string, to: string, timeZone: string): ReportRangeInstants => ({
  start: startOfLocalDay(from, timeZone),
  end: startOfLocalDay(addLocalDays(to, 1), timeZone),
});

// ================================================================ attendance

const STATUS_RANK: Record<AssignmentStatus, number> = { confirmed: 2, unconfirmed: 1, declined: 0 };

export interface AttendanceSheetRoleInput extends Omit<AttendanceSheetRole, 'can_mark'> {
  person_id: string;
  person_name: string;
  archived: boolean;
  can_mark: boolean;
}

/**
 * One row per Person (several positions are several roles on that row), each
 * with the Person's single record for the time. Counts are per Person.
 */
export const buildAttendanceSheetRows = (
  roles: readonly AttendanceSheetRoleInput[],
  records: readonly Pick<AttendanceRecordRow, 'id' | 'person_id' | 'status' | 'revision' | 'marked_by_name' | 'marked_at' | 'marked_team_id'>[],
): { rows: AttendanceSheetRow[]; counts: AttendanceCounts } => {
  const recordByPerson = new Map(records.map((record) => [record.person_id, record]));
  const byPerson = new Map<string, AttendanceSheetRow>();
  for (const role of roles) {
    if (role.response === 'declined') continue;
    const row =
      byPerson.get(role.person_id) ??
      ({
        person_id: role.person_id,
        person_name: role.person_name,
        archived: role.archived,
        roles: [],
        record: null,
        mark_team_id: null,
      } satisfies AttendanceSheetRow);
    row.roles.push({
      assignment_id: role.assignment_id,
      team_id: role.team_id,
      team_name: role.team_name,
      position_name: role.position_name,
      response: role.response,
      can_mark: role.can_mark,
    });
    if (!row.mark_team_id && role.can_mark) row.mark_team_id = role.team_id;
    byPerson.set(role.person_id, row);
  }
  const rows = [...byPerson.values()]
    .map((row) => {
      const record = recordByPerson.get(row.person_id);
      return {
        ...row,
        roles: [...row.roles].sort((a, b) => a.team_name.localeCompare(b.team_name) || STATUS_RANK[b.response] - STATUS_RANK[a.response]),
        record: record
          ? {
              id: record.id,
              status: record.status,
              revision: record.revision,
              marked_by_name: record.marked_by_name,
              marked_at: record.marked_at,
              marked_team_id: record.marked_team_id,
            }
          : null,
      };
    })
    .sort((a, b) => a.person_name.localeCompare(b.person_name));
  const counts: AttendanceCounts = { scheduled_people: rows.length, present: 0, absent: 0, unknown: 0, unmarked: 0 };
  for (const row of rows) {
    if (!row.record) counts.unmarked += 1;
    else counts[row.record.status] += 1;
  }
  return { rows, counts };
};

// =================================================================== filters

const planKeep = (plan: ReportPlanSource, filters: ReportFiltersApplied): boolean =>
  filters.plan_statuses.includes(plan.status) &&
  (filters.service_type_ids.length === 0 || (plan.service_type_id !== null && filters.service_type_ids.includes(plan.service_type_id)));

const assignmentKeep = (
  assignment: ReportAssignmentSource,
  filters: ReportFiltersApplied,
  people: ReadonlyMap<string, ReportPersonSource>,
): boolean =>
  (filters.team_ids.length === 0 || filters.team_ids.includes(assignment.team_id)) &&
  filters.assignment_statuses.includes(assignment.status) &&
  (filters.include_archived_people || !people.get(assignment.person_id)?.archived);

const byDateThenTitle = (a: { service_date: string; plan_title: string }, b: { service_date: string; plan_title: string }): number =>
  a.service_date.localeCompare(b.service_date) || a.plan_title.localeCompare(b.plan_title);

// ================================================================== staffing

export const buildStaffingReport = (input: {
  filters: ReportFiltersApplied;
  plans: readonly ReportPlanSource[];
  assignments: readonly ReportAssignmentSource[];
  needs: readonly ReportNeedSource[];
  people: readonly ReportPersonSource[];
}): { rows: StaffingReportRow[]; summary: StaffingSummary } => {
  const { filters } = input;
  const plans = new Map(input.plans.filter((plan) => planKeep(plan, filters)).map((plan) => [plan.id, plan]));
  const people = new Map(input.people.map((person) => [person.id, person]));
  // Vacancy arithmetic needs every released answer, so status filters apply to follow-ups only.
  const statusFree: ReportFiltersApplied = { ...filters, assignment_statuses: ['confirmed', 'unconfirmed', 'declined'] };
  const assignments = input.assignments.filter((a) => plans.has(a.plan_id) && assignmentKeep(a, statusFree, people));
  const rows = new Map<string, StaffingReportRow>();
  const rowFor = (planId: string, teamId: string, teamName: string, positionName: string): StaffingReportRow => {
    const key = `${planId}|${teamId}|${positionName}`;
    const existing = rows.get(key);
    if (existing) return existing;
    const plan = plans.get(planId)!;
    const row: StaffingReportRow = {
      plan_id: planId,
      plan_title: plan.title,
      service_date: plan.service_date,
      service_type: plan.service_type_name,
      team_id: teamId,
      team_name: teamName,
      position_name: positionName,
      needed: 0,
      confirmed: 0,
      pending: 0,
      declined: 0,
      vacancies: 0,
    };
    rows.set(key, row);
    return row;
  };
  for (const need of input.needs) {
    if (!plans.has(need.plan_id)) continue;
    if (filters.team_ids.length && !filters.team_ids.includes(need.team_id)) continue;
    rowFor(need.plan_id, need.team_id, need.team_name, need.position_name).needed += need.needed;
  }
  const followUps: StaffingFollowUp[] = [];
  for (const assignment of assignments) {
    const positionName = assignment.position_name ?? UNPOSITIONED_LABEL;
    const row = rowFor(assignment.plan_id, assignment.team_id, assignment.team_name, positionName);
    if (assignment.status === 'confirmed') row.confirmed += 1;
    else if (assignment.status === 'unconfirmed') row.pending += 1;
    else row.declined += 1;
    if (assignment.status !== 'confirmed' && filters.assignment_statuses.includes(assignment.status)) {
      const plan = plans.get(assignment.plan_id)!;
      followUps.push({
        plan_id: plan.id,
        plan_title: plan.title,
        service_date: plan.service_date,
        person_id: assignment.person_id,
        person_name: people.get(assignment.person_id)?.name ?? 'Unknown person',
        team_name: assignment.team_name,
        position_name: positionName,
        response: assignment.status,
        released_at: assignment.released_at,
      });
    }
  }
  const list = [...rows.values()]
    .map((row) => ({ ...row, vacancies: Math.max(0, row.needed - row.confirmed - row.pending) }))
    .sort((a, b) => byDateThenTitle(a, b) || a.team_name.localeCompare(b.team_name) || a.position_name.localeCompare(b.position_name));
  const summary: StaffingSummary = {
    plans: new Set(list.map((row) => row.plan_id)).size,
    needed: 0,
    confirmed: 0,
    pending: 0,
    declined: 0,
    vacancies: 0,
    follow_ups: followUps.sort(
      (a, b) => byDateThenTitle(a, b) || a.person_name.localeCompare(b.person_name) || a.team_name.localeCompare(b.team_name),
    ),
  };
  for (const row of list) {
    summary.needed += row.needed;
    summary.confirmed += row.confirmed;
    summary.pending += row.pending;
    summary.declined += row.declined;
    summary.vacancies += row.vacancies;
  }
  return { rows: list, summary };
};

// ============================================================= participation

export const buildParticipationReport = (input: {
  filters: ReportFiltersApplied;
  plans: readonly ReportPlanSource[];
  assignments: readonly ReportAssignmentSource[];
  people: readonly ReportPersonSource[];
  attendance: readonly ReportAttendanceSource[];
}): { rows: ParticipationReportRow[]; summary: ParticipationSummary } => {
  const { filters } = input;
  const plans = new Map(input.plans.filter((plan) => planKeep(plan, filters)).map((plan) => [plan.id, plan]));
  const people = new Map(input.people.map((person) => [person.id, person]));
  const assignments = input.assignments.filter((a) => plans.has(a.plan_id) && assignmentKeep(a, filters, people));

  interface Acc {
    row: ParticipationReportRow;
    plans: Set<string>;
    teams: Set<string>;
  }
  const acc = new Map<string, Acc>();
  const teamAcc = new Map<string, { total: ParticipationTeamTotal; people: Set<string>; personPlans: Set<string> }>();
  for (const assignment of assignments) {
    const person = people.get(assignment.person_id);
    const entry =
      acc.get(assignment.person_id) ??
      ({
        row: {
          person_id: assignment.person_id,
          person_name: person?.name ?? 'Unknown person',
          archived: person?.archived ?? false,
          teams: [],
          assignments: 0,
          person_plans: 0,
          confirmed: 0,
          pending: 0,
          declined: 0,
          present: 0,
          absent: 0,
          unknown: 0,
          last_service_date: null,
        },
        plans: new Set<string>(),
        teams: new Set<string>(),
      } satisfies Acc);
    entry.row.assignments += 1;
    if (assignment.status === 'confirmed') entry.row.confirmed += 1;
    else if (assignment.status === 'unconfirmed') entry.row.pending += 1;
    else entry.row.declined += 1;
    entry.plans.add(assignment.plan_id);
    entry.teams.add(assignment.team_name);
    const date = plans.get(assignment.plan_id)!.service_date;
    if (assignment.status !== 'declined' && (!entry.row.last_service_date || date > entry.row.last_service_date)) {
      entry.row.last_service_date = date;
    }
    acc.set(assignment.person_id, entry);

    const team =
      teamAcc.get(assignment.team_id) ??
      {
        total: { team_id: assignment.team_id, team_name: assignment.team_name, assignments: 0, people: 0, person_plans: 0 },
        people: new Set<string>(),
        personPlans: new Set<string>(),
      };
    team.total.assignments += 1;
    team.people.add(assignment.person_id);
    team.personPlans.add(`${assignment.person_id}|${assignment.plan_id}`);
    teamAcc.set(assignment.team_id, team);
  }

  // Attendance: one record per (person, time); only people/plans in scope.
  const seen = new Set<string>();
  for (const record of input.attendance) {
    if (!plans.has(record.plan_id)) continue;
    if (!filters.include_rehearsals && record.time_kind !== 'service') continue;
    const entry = acc.get(record.person_id);
    if (!entry || !entry.plans.has(record.plan_id)) continue;
    const key = `${record.person_id}|${record.plan_time_id ?? record.plan_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entry.row[record.status] += 1;
  }

  const rows = [...acc.values()]
    .map(({ row, plans: personPlans, teams }) => ({ ...row, person_plans: personPlans.size, teams: [...teams].sort() }))
    .sort((a, b) => b.person_plans - a.person_plans || a.person_name.localeCompare(b.person_name));
  const summary: ParticipationSummary = {
    assignments: rows.reduce((sum, row) => sum + row.assignments, 0),
    people: rows.length,
    person_plans: rows.reduce((sum, row) => sum + row.person_plans, 0),
    present: rows.reduce((sum, row) => sum + row.present, 0),
    absent: rows.reduce((sum, row) => sum + row.absent, 0),
    teams: [...teamAcc.values()]
      .map(({ total, people: teamPeople, personPlans }) => ({ ...total, people: teamPeople.size, person_plans: personPlans.size }))
      .sort((a, b) => a.team_name.localeCompare(b.team_name)),
  };
  return { rows, summary };
};

// ================================================================ song usage

export const buildSongUsageReport = (input: {
  filters: ReportFiltersApplied;
  plans: readonly ReportPlanSource[];
  items: readonly ReportSongItemSource[];
}): { rows: SongUsageReportRow[]; summary: SongUsageSummary } => {
  const plans = new Map(input.plans.filter((plan) => planKeep(plan, input.filters)).map((plan) => [plan.id, plan]));
  const acc = new Map<string, { row: SongUsageReportRow; plans: Set<string>; keys: Set<string> }>();
  const allPlans = new Set<string>();
  let occurrences = 0;
  for (const item of input.items) {
    const plan = plans.get(item.plan_id);
    if (!plan) continue;
    occurrences += 1;
    allPlans.add(plan.id);
    const entry =
      acc.get(item.song_id) ??
      {
        row: {
          song_id: item.song_id,
          title: item.title,
          author: item.author,
          occurrences: 0,
          plans: 0,
          keys: [],
          first_used: plan.service_date,
          last_used: plan.service_date,
        },
        plans: new Set<string>(),
        keys: new Set<string>(),
      };
    entry.row.occurrences += 1;
    entry.plans.add(plan.id);
    if (item.key) entry.keys.add(item.key);
    if (plan.service_date < entry.row.first_used) entry.row.first_used = plan.service_date;
    if (plan.service_date > entry.row.last_used) entry.row.last_used = plan.service_date;
    acc.set(item.song_id, entry);
  }
  const rows = [...acc.values()]
    .map(({ row, plans: songPlans, keys }) => ({ ...row, plans: songPlans.size, keys: [...keys].sort() }))
    .sort((a, b) => b.occurrences - a.occurrences || b.plans - a.plans || a.title.localeCompare(b.title));
  return { rows, summary: { occurrences, songs: rows.length, plans: allPlans.size } };
};

// ================================================================= run times

export const buildRunTimesReport = (input: {
  filters: ReportFiltersApplied;
  plans: readonly ReportPlanSource[];
  runs: readonly ReportRunSource[];
}): { rows: RunTimesReportRow[]; summary: RunTimesSummary } => {
  const plans = new Map(input.plans.filter((plan) => planKeep(plan, input.filters)).map((plan) => [plan.id, plan]));
  const rows = input.runs
    .filter((run) => plans.has(run.plan_id))
    .map((run) => {
      const plan = plans.get(run.plan_id)!;
      return {
        run_id: run.run_id,
        plan_id: plan.id,
        plan_title: plan.title,
        service_date: plan.service_date,
        time_name: run.time_name,
        time_starts_at: run.time_starts_at,
        planned_seconds: run.planned_seconds,
        actual_seconds: run.actual_seconds,
        difference_seconds: run.actual_seconds - run.planned_seconds,
        items: run.items,
        items_over: run.items_over,
        corrected: run.corrected,
      };
    })
    .sort((a, b) => a.time_starts_at.localeCompare(b.time_starts_at));
  const planned = rows.reduce((sum, row) => sum + row.planned_seconds, 0);
  const actual = rows.reduce((sum, row) => sum + row.actual_seconds, 0);
  return {
    rows,
    summary: {
      runs: rows.length,
      planned_seconds: planned,
      actual_seconds: actual,
      average_difference_seconds: rows.length ? Math.round((actual - planned) / rows.length) : 0,
    },
  };
};

// ================================================================== schedule

export const buildScheduleReport = (input: {
  filters: ReportFiltersApplied;
  plans: readonly ReportPlanSource[];
  assignments: readonly ReportAssignmentSource[];
  people: readonly ReportPersonSource[];
  times: readonly ReportTimeSource[];
}): { rows: ScheduleReportRow[]; summary: ScheduleSummary } => {
  const { filters } = input;
  const plans = new Map(input.plans.filter((plan) => planKeep(plan, filters)).map((plan) => [plan.id, plan]));
  const people = new Map(input.people.map((person) => [person.id, person]));
  const times = new Map(input.times.map((time) => [time.id, time]));
  const rows: ScheduleReportRow[] = input.assignments
    .filter((a) => plans.has(a.plan_id) && assignmentKeep(a, filters, people))
    .map((a) => {
      const plan = plans.get(a.plan_id)!;
      return {
        plan_id: plan.id,
        plan_title: plan.title,
        service_date: plan.service_date,
        service_type: plan.service_type_name,
        team_name: a.team_name,
        position_name: a.position_name ?? UNPOSITIONED_LABEL,
        person_id: a.person_id,
        person_name: people.get(a.person_id)?.name ?? 'Unknown person',
        response: a.status,
        times: a.time_ids
          .map((id) => times.get(id))
          .filter((time): time is ReportTimeSource => Boolean(time) && (filters.include_rehearsals || time!.kind === 'service'))
          .map((time) => time.name ?? (time.kind === 'service' ? 'Service' : 'Rehearsal')),
      };
    })
    .sort(
      (a, b) =>
        byDateThenTitle(a, b) ||
        a.team_name.localeCompare(b.team_name) ||
        a.position_name.localeCompare(b.position_name) ||
        a.person_name.localeCompare(b.person_name),
    );
  return {
    rows,
    summary: {
      plans: new Set(rows.map((row) => row.plan_id)).size,
      assignments: rows.length,
      people: new Set(rows.map((row) => row.person_id)).size,
    },
  };
};

// ======================================================================= CSV

/**
 * Spreadsheet formula injection: a cell beginning with = + - @ (or a tab/CR)
 * is prefixed with an apostrophe so spreadsheet apps show it as text.
 */
export const escapeCsvCell = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string =>
  rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';

export interface ReportTable {
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

const secondsLabel = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
};

/** The table every format prints: the same columns on screen, in print and in CSV. */
export const reportTable = (report: {
  kind: ReportKind;
  rows: readonly unknown[];
  filters: Pick<ReportFiltersApplied, 'timezone'>;
}): ReportTable => {
  const tz = report.filters.timezone;
  const day = (instant: string): string => localDateAt(instant, tz);
  switch (report.kind) {
    case 'staffing':
      return {
        columns: ['Date', 'Plan', 'Service type', 'Team', 'Position', 'Needed', 'Confirmed', 'Pending', 'Declined', 'Vacancies'],
        rows: (report.rows as StaffingReportRow[]).map((row) => [
          day(row.service_date), row.plan_title, row.service_type, row.team_name, row.position_name,
          row.needed, row.confirmed, row.pending, row.declined, row.vacancies,
        ]),
      };
    case 'participation':
      return {
        columns: ['Person', 'Archived', 'Teams', 'Assignments', 'Person-plans', 'Confirmed', 'Pending', 'Declined', 'Present', 'Absent', 'Unknown', 'Last scheduled'],
        rows: (report.rows as ParticipationReportRow[]).map((row) => [
          row.person_name, row.archived ? 'yes' : 'no', row.teams.join('; '), row.assignments, row.person_plans,
          row.confirmed, row.pending, row.declined, row.present, row.absent, row.unknown,
          row.last_service_date ? day(row.last_service_date) : null,
        ]),
      };
    case 'song_usage':
      return {
        columns: ['Song', 'Author', 'Occurrences', 'Plans', 'Keys', 'First used', 'Last used'],
        rows: (report.rows as SongUsageReportRow[]).map((row) => [
          row.title, row.author, row.occurrences, row.plans, row.keys.join('; '), day(row.first_used), day(row.last_used),
        ]),
      };
    case 'run_times':
      return {
        columns: ['Date', 'Plan', 'Time', 'Planned', 'Actual', 'Difference', 'Items', 'Items over', 'Corrected'],
        rows: (report.rows as RunTimesReportRow[]).map((row) => [
          day(row.time_starts_at), row.plan_title, row.time_name, secondsLabel(row.planned_seconds),
          secondsLabel(row.actual_seconds), secondsLabel(row.difference_seconds), row.items, row.items_over,
          row.corrected ? 'yes' : 'no',
        ]),
      };
    case 'schedule':
      return {
        columns: ['Date', 'Plan', 'Service type', 'Team', 'Position', 'Person', 'Response', 'Times'],
        rows: (report.rows as ScheduleReportRow[]).map((row) => [
          day(row.service_date), row.plan_title, row.service_type, row.team_name, row.position_name,
          row.person_name, row.response, row.times.join('; '),
        ]),
      };
  }
};

/** CSV with a header block: title, generation time, timezone, filters and definitions. */
export const reportToCsv = (report: {
  kind: ReportKind;
  title: string;
  generated_at: string;
  filters: ReportFiltersApplied;
  definitions: readonly ReportMetricDefinition[];
  scope_note: string | null;
  truncated: boolean;
  rows: readonly unknown[];
}): string => {
  const table = reportTable(report);
  const f = report.filters;
  const header: Array<Array<string | number | null>> = [
    ['Report', report.title],
    ['Generated at (UTC)', report.generated_at],
    ['Timezone', f.timezone],
    ['Dates', `${f.from} to ${f.to}`],
    ['Plan statuses', f.plan_statuses.join('; ')],
    ['Responses', f.assignment_statuses.join('; ')],
    ['Service types', f.service_type_ids.length ? f.service_type_ids.join('; ') : 'all permitted'],
    ['Teams', f.team_ids.length ? f.team_ids.join('; ') : 'all permitted'],
    ['Archived people', f.include_archived_people ? 'included' : 'excluded'],
    ['Rehearsals', f.include_rehearsals ? 'included' : 'excluded'],
    ...(report.scope_note ? [['Scope', report.scope_note]] : []),
    ...(report.truncated ? [['Truncated', `first ${REPORT_ROW_LIMIT} rows`]] : []),
    ...report.definitions.map((d) => [`Definition: ${d.label}`, d.definition]),
    [],
  ];
  return toCsv([...header, table.columns, ...table.rows]);
};

export const reportFilename = (kind: ReportKind, filters: Pick<ReportFiltersApplied, 'from' | 'to'>): string =>
  `${kind.replace('_', '-')}-${filters.from}-to-${filters.to}.csv`;

// =============================================================== publication

export const PUBLIC_PLAN_FIELD_LABELS: Record<PublicPlanField, string> = {
  title: 'Plan title',
  date: 'Service date',
  times: 'Service times',
  location: 'Location',
  service_type: 'Service type',
  order: 'Order of service (item titles)',
  item_lengths: 'Item lengths',
  songs: 'Song titles',
  song_authors: 'Song authors',
  song_keys: 'Song keys',
};

/** Never selectable for publication, whatever a client sends. */
export const PUBLIC_EXCLUDED_ALWAYS = ['people and staffing', 'contact details', 'notes and descriptions', 'files', 'chat', 'rehearsal times'] as const;

export interface PublicationWindowInput {
  publish_mode: PublishMode;
  published_at: string;
  revoked_at: string | null;
  plan_status: string;
  service_date: string;
  timezone: string;
}

/** When the projection becomes visible (null = never, e.g. revoked). */
export const publicationVisibleFrom = (input: PublicationWindowInput): string | null => {
  if (input.revoked_at) return null;
  if (input.publish_mode === 'now') return input.published_at;
  const serviceDay = localDateAt(input.service_date, input.timezone);
  const dayStart = startOfLocalDay(serviceDay, input.timezone);
  return dayStart > input.published_at ? dayStart : input.published_at;
};

export const publicationState = (input: PublicationWindowInput, nowMs: number): PublicationState => {
  if (input.revoked_at) return 'revoked';
  if (input.plan_status !== 'published') return 'ineligible';
  const from = publicationVisibleFrom(input);
  if (!from) return 'revoked';
  return Date.parse(from) <= nowMs ? 'live' : 'scheduled';
};

/** The allowlisted projection: only the chosen fields; never people, notes, files or chat. */
export const buildPublicPlanProjection = (
  source: PublicPlanSource,
  fields: readonly PublicPlanField[],
): PublicPlanProjection => {
  const has = (field: PublicPlanField): boolean => fields.includes(field);
  const projection: PublicPlanProjection = { organization: source.organization_name, timezone: source.timezone };
  if (has('title')) projection.title = source.plan.title;
  if (has('date')) projection.date = localDateAt(source.plan.service_date, source.timezone);
  if (has('service_type')) projection.service_type = source.plan.service_type_name;
  if (has('location')) projection.location = source.plan.location;
  if (has('times')) {
    projection.times = source.times
      .filter((time) => time.kind === 'service')
      .map((time) => ({ name: time.name, starts_at: time.starts_at, ends_at: time.ends_at }));
  }
  const song = (item: PublicPlanSource['items'][number]): NonNullable<PublicPlanItem['song']> => ({
    title: item.song!.title,
    ...(has('song_authors') ? { author: item.song!.author } : {}),
    ...(has('song_keys') ? { key: item.key } : {}),
  });
  if (has('order')) {
    projection.items = source.items.map((item) => ({
      kind: item.item_type,
      // A song row shows its song title only when songs are published.
      title: item.item_type === 'song' && !has('songs') ? 'Song' : item.title,
      ...(has('item_lengths') && item.item_type !== 'header' ? { length_seconds: item.length_seconds } : {}),
      ...(has('songs') && item.song ? { song: song(item) } : {}),
    }));
  }
  if (has('songs')) {
    projection.songs = source.items.filter((item) => item.song).map(song);
  }
  return projection;
};
