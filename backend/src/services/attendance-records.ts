import {
  buildAttendanceSheetRows,
  type AttendanceBatchResult,
  type AttendanceHistoryEntry,
  type AttendanceRecordRow,
  type AttendanceSheet,
  type EffectiveAccess,
  type RecordAttendanceInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { attendanceFor } from './attendance.js';
import {
  defaultAttendanceTime,
  seesWholePlan,
  toAttendanceMarkRpc,
  toAttendanceTimeOption,
  toSheetRoles,
  type AttendanceAssignmentRow,
  type AttendancePersonRow,
  type AttendancePlanTimeRow,
} from '../model/attendance-record.model.js';
import { personName } from '../model/availability.model.js';

/** The caller's RLS-bound client, organization and effective access. */
export interface AttendanceCaller {
  db: Db;
  orgId: string;
  access: EffectiveAccess;
}

interface AttendancePlanRow {
  id: string;
  service_type_id: string | null;
}

const loadPlan = async ({ db, orgId }: AttendanceCaller, planId: string): Promise<AttendancePlanRow> => {
  const plan = await unwrap(
    db.from('plans').select('id, service_type_id').eq('id', planId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  return plan;
};

const loadPeople = async (db: Db, ids: readonly string[]): Promise<Map<string, AttendancePersonRow>> => {
  if (ids.length === 0) return new Map();
  const rows = (await unwrap(
    db.from('people_directory').select('id, first_name, last_name, archived_at').in('id', [...ids]),
  )) as AttendancePersonRow[] | null;
  return new Map((rows ?? []).map((row) => [row.id, row]));
};

/**
 * One plan time: every Person with a released, not-declined request covering
 * it (F04 resolver), one row each, with their single record. Rows on teams
 * the caller does not schedule are counted, not shown.
 */
export const getAttendanceSheet = async (
  caller: AttendanceCaller,
  planId: string,
  planTimeId: string | undefined,
  nowMs: number = Date.now(),
): Promise<AttendanceSheet> => {
  const plan = await loadPlan(caller, planId);
  const times = ((await unwrap(
    caller.db.from('plan_times').select('id, kind, name, starts_at, ends_at').eq('plan_id', planId).order('starts_at'),
  )) ?? []) as AttendancePlanTimeRow[];
  const time = planTimeId ? times.find((candidate) => candidate.id === planTimeId) : defaultAttendanceTime(times, nowMs);
  if (!time) throw HttpError.notFound(planTimeId ? 'Plan time not found' : 'This plan has no times to take attendance for');

  const assignments = ((await unwrap(
    raw(caller.db)
      .from('assignments')
      .select('id, person_id, team_id, status, team:teams(name), position:team_positions(name)')
      .eq('plan_id', planId)
      .eq('visibility', 'released'),
  )) ?? []) as unknown as AttendanceAssignmentRow[];
  const intervals = await attendanceFor(caller.db, assignments.map((assignment) => assignment.id));
  const covering = new Set(
    assignments
      .filter((assignment) => (intervals.get(assignment.id) ?? []).some((interval) => interval.plan_time_id === time.id))
      .map((assignment) => assignment.id),
  );

  const [people, records] = await Promise.all([
    loadPeople(caller.db, [...new Set(assignments.map((assignment) => assignment.person_id))]),
    unwrap(caller.db.from('attendance_records').select('*').eq('plan_time_id', time.id)),
  ]);
  const visibleRecords = (records ?? []) as AttendanceRecordRow[];

  const whole = seesWholePlan(caller.access, plan.service_type_id);
  const roles = toSheetRoles(assignments, covering, people, caller.access, plan.service_type_id);
  const visibleRoles = whole
    ? roles
    : roles.filter((role) => roles.some((other) => other.person_id === role.person_id && other.can_mark));
  const hiddenPeople = new Set(
    roles.filter((role) => role.response !== 'declined' && !visibleRoles.includes(role)).map((role) => role.person_id),
  );
  const { rows, counts } = buildAttendanceSheetRows(visibleRoles, visibleRecords);
  const scheduled = new Set(rows.map((row) => row.person_id));
  const orphanIds = visibleRecords.filter((record) => !scheduled.has(record.person_id)).map((record) => record.person_id);
  const orphanPeople = await loadPeople(caller.db, orphanIds.filter((id) => !people.has(id)));

  return {
    plan_id: planId,
    time: toAttendanceTimeOption(time),
    times: times.map(toAttendanceTimeOption),
    rows,
    counts,
    orphaned_records: visibleRecords
      .filter((record) => !scheduled.has(record.person_id) && !hiddenPeople.has(record.person_id))
      .map((record) => ({ ...record, person_name: personName(people.get(record.person_id) ?? orphanPeople.get(record.person_id)) })),
    hidden_people: hiddenPeople.size,
    can_mark_any: rows.some((row) => row.mark_team_id !== null),
  };
};

/** One atomic batch through `record_attendance` (authority, revisions and idempotency in the database). */
export const recordAttendance = async (
  caller: AttendanceCaller,
  planId: string,
  input: RecordAttendanceInput,
): Promise<AttendanceBatchResult> => {
  await loadPlan(caller, planId);
  const time = await unwrap(
    caller.db.from('plan_times').select('id').eq('id', input.plan_time_id).eq('plan_id', planId).maybeSingle(),
  );
  if (!time) throw HttpError.notFound('Plan time not found');
  const { data, error } = await caller.db.rpc('record_attendance', {
    p_plan_time_id: input.plan_time_id,
    p_marks: input.marks.map(toAttendanceMarkRpc),
    p_reason: input.reason ?? null,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Plan time not found');
  return data;
};

interface HistoryEventRow {
  id: number;
  record_id: string;
  organization_id: string;
  batch_id: string | null;
  revision: number;
  previous_status: AttendanceHistoryEntry['previous_status'];
  status: AttendanceHistoryEntry['status'];
  team_id: string | null;
  reason: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  occurred_at: string;
  team: { name: string } | null;
}

/** Every mark and correction of one Person at one time, oldest first. */
export const getAttendanceHistory = async (
  caller: AttendanceCaller,
  planId: string,
  planTimeId: string,
  personId: string,
): Promise<AttendanceHistoryEntry[]> => {
  await loadPlan(caller, planId);
  const record = await unwrap(
    caller.db
      .from('attendance_records')
      .select('id')
      .eq('plan_id', planId)
      .eq('plan_time_id', planTimeId)
      .eq('person_id', personId)
      .maybeSingle(),
  );
  if (!record) return [];
  const events = ((await unwrap(
    raw(caller.db)
      .from('attendance_events')
      .select('*, team:teams(name)')
      .eq('record_id', record.id)
      .order('revision', { ascending: true }),
  )) ?? []) as unknown as HistoryEventRow[];
  return events.map(({ team, ...event }) => ({ ...event, team_name: team?.name ?? null }));
};
