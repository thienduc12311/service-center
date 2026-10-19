import {
  buildParticipationReport,
  buildRunTimesReport,
  buildScheduleReport,
  buildSongUsageReport,
  buildStaffingReport,
  computeRunActuals,
  reportRangeInstants,
  REPORT_DEFINITIONS,
  REPORT_PLAN_LIMIT,
  REPORT_ROW_LIMIT,
  REPORT_TITLES,
  type AnyReport,
  type EffectiveAccess,
  type LiveRun,
  type LiveRunCorrectionRow,
  type LiveRunTransitionRow,
  type ReportAssignmentSource,
  type ReportFiltersApplied,
  type ReportFiltersInput,
  type ReportKind,
  type ReportPersonSource,
  type ReportPlanSource,
  type ReportTimeSource,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { attendanceFor } from './attendance.js';
import { personName } from '../model/availability.model.js';
import {
  applyReportFilters,
  canRunReport,
  planInScope,
  scopeNote,
  teamInScope,
  toReportAssignment,
  toReportAttendance,
  toReportNeed,
  toReportPlan,
  toReportRun,
  toReportSongItem,
  type EndedRunRow,
  type ReportAssignmentRow,
  type ReportAttendanceRow,
  type ReportNeedRow,
  type ReportPersonRow,
  type ReportPlanRow,
  type ReportSongItemRow,
} from '../model/report.model.js';

/**
 * Who a report is built for. The API passes the caller's RLS-bound client;
 * the export worker passes the service role with the requester's *current*
 * access. Every query filters organization, visibility and scope explicitly,
 * so both produce the same rows.
 */
export interface ReportContext {
  db: Db;
  orgId: string;
  access: EffectiveAccess;
  /** Service role: names come from `people` (the directory view needs a signed-in member). */
  serviceRole: boolean;
}

/** `.in()` lists stay well inside URL limits. */
const CHUNK = 100;

const chunks = <T>(values: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += CHUNK) out.push(values.slice(start, start + CHUNK));
  return out;
};

const inChunks = async <T>(ids: readonly string[], load: (chunk: string[]) => PromiseLike<T[] | null>): Promise<T[]> => {
  const rows: T[] = [];
  for (const chunk of chunks(ids)) rows.push(...((await load(chunk)) ?? []));
  return rows;
};

export const organizationTimezone = async (db: Db, orgId: string): Promise<string> => {
  const org = await unwrap(db.from('organizations').select('timezone').eq('id', orgId).maybeSingle());
  if (!org) throw HttpError.notFound('Organization not found');
  return org.timezone;
};

const loadPlans = async (
  ctx: ReportContext,
  kind: ReportKind,
  filters: ReportFiltersApplied,
): Promise<{ plans: ReportPlanSource[]; truncated: boolean }> => {
  const range = reportRangeInstants(filters.from, filters.to, filters.timezone);
  let query = raw(ctx.db)
    .from('plans')
    .select('id, title, service_date, status, service_type_id, service_type:service_types(name)')
    .eq('organization_id', ctx.orgId)
    .gte('service_date', range.start)
    .lt('service_date', range.end)
    .in('status', filters.plan_statuses)
    .order('service_date')
    .order('id')
    .limit(REPORT_PLAN_LIMIT + 1);
  if (filters.service_type_ids.length) query = query.in('service_type_id', filters.service_type_ids);
  const rows = ((await unwrap(query)) ?? []) as unknown as ReportPlanRow[];
  return {
    plans: rows
      .slice(0, REPORT_PLAN_LIMIT)
      .map(toReportPlan)
      .filter((plan) => planInScope(ctx.access, kind, plan.service_type_id)),
    truncated: rows.length > REPORT_PLAN_LIMIT,
  };
};

const loadPeople = async (ctx: ReportContext, ids: readonly string[]): Promise<ReportPersonSource[]> => {
  const source = ctx.serviceRole ? 'people' : 'people_directory';
  const rows = await inChunks(ids, async (chunk) =>
    ((await unwrap(
      raw(ctx.db).from(source).select('id, first_name, last_name, archived_at').eq('organization_id', ctx.orgId).in('id', chunk),
    )) ?? []) as ReportPersonRow[],
  );
  return rows.map((row) => ({ id: row.id, name: personName(row), archived: Boolean(row.archived_at) }));
};

/** Released requests on the plans, limited to teams the reader schedules, with their F04 times. */
const loadAssignments = async (ctx: ReportContext, plans: readonly ReportPlanSource[]): Promise<ReportAssignmentSource[]> => {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const rows = await inChunks(plans.map((plan) => plan.id), async (chunk) =>
    ((await unwrap(
      raw(ctx.db)
        .from('assignments')
        .select('id, plan_id, person_id, team_id, status, released_at, team:teams(name), position:team_positions(name)')
        .in('plan_id', chunk)
        .eq('visibility', 'released'),
    )) ?? []) as unknown as ReportAssignmentRow[],
  );
  const scoped = rows.filter((row) => teamInScope(ctx.access, byId.get(row.plan_id)?.service_type_id ?? null, row.team_id));
  const intervals = await attendanceFor(ctx.db, scoped.map((row) => row.id));
  return scoped.map((row) =>
    toReportAssignment(
      row,
      (intervals.get(row.id) ?? []).flatMap((interval) => (interval.plan_time_id ? [interval.plan_time_id] : [])),
    ),
  );
};

const loadNeeds = async (ctx: ReportContext, plans: readonly ReportPlanSource[]) => {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const rows = await inChunks(plans.map((plan) => plan.id), async (chunk) =>
    ((await unwrap(
      raw(ctx.db)
        .from('plan_position_needs')
        .select('plan_id, needed, position:team_positions(name, team_id, team:teams(name))')
        .in('plan_id', chunk),
    )) ?? []) as unknown as ReportNeedRow[],
  );
  return rows
    .map(toReportNeed)
    .filter((need): need is NonNullable<typeof need> => need !== null)
    .filter((need) => teamInScope(ctx.access, byId.get(need.plan_id)?.service_type_id ?? null, need.team_id));
};

const loadAttendance = async (ctx: ReportContext, plans: readonly ReportPlanSource[]) =>
  (
    await inChunks(plans.map((plan) => plan.id), async (chunk) =>
      ((await unwrap(
        raw(ctx.db)
          .from('attendance_records')
          .select('plan_id, plan_time_id, person_id, status, time_kind')
          .eq('organization_id', ctx.orgId)
          .in('plan_id', chunk),
      )) ?? []) as ReportAttendanceRow[],
    )
  ).map(toReportAttendance);

const loadTimes = async (ctx: ReportContext, plans: readonly ReportPlanSource[]): Promise<ReportTimeSource[]> =>
  inChunks(plans.map((plan) => plan.id), async (chunk) =>
    ((await unwrap(
      raw(ctx.db).from('plan_times').select('id, plan_id, kind, name, starts_at').in('plan_id', chunk),
    )) ?? []) as ReportTimeSource[],
  );

const loadSongItems = async (ctx: ReportContext, plans: readonly ReportPlanSource[]) =>
  (
    await inChunks(plans.map((plan) => plan.id), async (chunk) =>
      ((await unwrap(
        raw(ctx.db)
          .from('plan_items')
          .select('id, plan_id, song_id, key_override, song:songs(title, author, default_key), arrangement:arrangements(song_key)')
          .in('plan_id', chunk)
          .eq('item_type', 'song'),
      )) ?? []) as unknown as ReportSongItemRow[],
    )
  )
    .map(toReportSongItem)
    .filter((item): item is NonNullable<typeof item> => item !== null);

/** Ended runs only, with actuals derived from transitions and audited corrections. */
const loadRuns = async (ctx: ReportContext, plans: readonly ReportPlanSource[]) => {
  const runs = (await inChunks(plans.map((plan) => plan.id), async (chunk) =>
    ((await unwrap(
      raw(ctx.db)
        .from('live_runs')
        .select('*')
        .eq('organization_id', ctx.orgId)
        .in('plan_id', chunk)
        .eq('status', 'ended'),
    )) ?? []) as LiveRun[],
  )).slice(0, REPORT_ROW_LIMIT);
  const runIds = runs.map((run) => run.id);
  const [transitions, corrections] = await Promise.all([
    inChunks(runIds, async (chunk) =>
      ((await unwrap(raw(ctx.db).from('live_run_transitions').select('*').in('run_id', chunk).order('id'))) ?? []) as LiveRunTransitionRow[],
    ),
    inChunks(runIds, async (chunk) =>
      ((await unwrap(raw(ctx.db).from('live_run_corrections').select('*').in('run_id', chunk).order('id'))) ?? []) as LiveRunCorrectionRow[],
    ),
  ]);
  return runs.map((run) =>
    toReportRun(
      run as EndedRunRow & LiveRun,
      computeRunActuals(
        run,
        transitions.filter((transition) => transition.run_id === run.id),
        corrections.filter((correction) => correction.run_id === run.id),
      ),
    ),
  );
};

/**
 * Builds one report. Refuses a kind the reader may not run (the database's
 * `private.can_run_report` makes the same decision for exports).
 */
export const buildReport = async (
  ctx: ReportContext,
  kind: ReportKind,
  input: ReportFiltersInput,
  now: Date = new Date(),
): Promise<AnyReport> => {
  if (!canRunReport(ctx.access, kind)) throw HttpError.forbidden('You cannot run this report');
  const filters = applyReportFilters(input, await organizationTimezone(ctx.db, ctx.orgId));
  const { plans, truncated: plansTruncated } = await loadPlans(ctx, kind, filters);
  const base = {
    title: REPORT_TITLES[kind],
    generated_at: now.toISOString(),
    filters,
    definitions: REPORT_DEFINITIONS[kind],
    scope_note: scopeNote(ctx.access, kind),
  };
  const cap = <T>(rows: T[]): { rows: T[]; truncated: boolean } => ({
    rows: rows.slice(0, REPORT_ROW_LIMIT),
    truncated: plansTruncated || rows.length > REPORT_ROW_LIMIT,
  });

  switch (kind) {
    case 'staffing': {
      const [assignments, needs] = await Promise.all([loadAssignments(ctx, plans), loadNeeds(ctx, plans)]);
      const people = await loadPeople(ctx, [...new Set(assignments.map((a) => a.person_id))]);
      const built = buildStaffingReport({ filters, plans, assignments, needs, people });
      return { kind, ...base, summary: built.summary, ...cap(built.rows) };
    }
    case 'participation': {
      const [assignments, attendance] = await Promise.all([loadAssignments(ctx, plans), loadAttendance(ctx, plans)]);
      const people = await loadPeople(ctx, [...new Set(assignments.map((a) => a.person_id))]);
      const built = buildParticipationReport({ filters, plans, assignments, people, attendance });
      return { kind, ...base, summary: built.summary, ...cap(built.rows) };
    }
    case 'schedule': {
      const [assignments, times] = await Promise.all([loadAssignments(ctx, plans), loadTimes(ctx, plans)]);
      const people = await loadPeople(ctx, [...new Set(assignments.map((a) => a.person_id))]);
      const built = buildScheduleReport({ filters, plans, assignments, people, times });
      return { kind, ...base, summary: built.summary, ...cap(built.rows) };
    }
    case 'song_usage': {
      const built = buildSongUsageReport({ filters, plans, items: await loadSongItems(ctx, plans) });
      return { kind, ...base, summary: built.summary, ...cap(built.rows) };
    }
    case 'run_times': {
      const built = buildRunTimesReport({ filters, plans, runs: await loadRuns(ctx, plans) });
      return { kind, ...base, summary: built.summary, ...cap(built.rows) };
    }
  }
};
