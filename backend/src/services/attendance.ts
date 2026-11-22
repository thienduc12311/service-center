import { randomUUID } from 'node:crypto';
import type {
  AttendanceConflict,
  AttendanceInterval,
  ConflictCandidateInput,
  ConflictCheckResult,
  OrphanResolutionInput,
  PlanTimeChangeResult,
  PlanTimeImpact,
  PlanTimeImpactAssignment,
  PlanTimeRow,
  UpdatePlanInput,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { fetchAllPages, inChunks } from '../lib/paging.js';
import {
  assignLegacyTimeIds,
  groupAttendance,
  impactConflictCandidates,
  summarizeConflicts,
  toConflict,
  type IdentifiedPlanTime,
  type IntervalCandidate,
  type PlanTimeDraft,
  type RawConflictRow,
} from '../model/attendance.model.js';
import { personName, type PersonNameRow } from '../model/availability.model.js';

/** Assignment ids per `assignment_attendance_for` call (the function accepts at most 2000). */
export const ATTENDANCE_ID_CHUNK = 500;

/**
 * F04: the one attendance resolver, read through the caller's RLS (or the
 * service role for the feed). Every surface that shows "which times" uses it.
 * Each assignment yields one row per time it covers, so a chunk's answer can
 * pass PostgREST's 1000-row cap: every call is paged on the result's unique
 * key `(assignment_id, plan_time_id)` (at most one untimed row, with a null
 * time, per assignment).
 */
export const attendanceFor = async (
  db: Db,
  assignmentIds: readonly string[],
): Promise<Map<string, AttendanceInterval[]>> => {
  if (assignmentIds.length === 0) return new Map();
  const rows: AttendanceInterval[] = [];
  for (let start = 0; start < assignmentIds.length; start += ATTENDANCE_ID_CHUNK) {
    const chunk = assignmentIds.slice(start, start + ATTENDANCE_ID_CHUNK);
    const page = await fetchAllPages(async (from, to) =>
      unwrap(
        db
          .rpc('assignment_attendance_for', { p_assignment_ids: [...chunk] })
          .order('assignment_id')
          .order('plan_time_id', { nullsFirst: false })
          .range(from, to),
      ),
    );
    rows.push(...page);
  }
  return groupAttendance(rows);
};

export interface ConflictContext {
  db: Db;
  orgId: string;
}

type CandidatePayload = ConflictCandidateInput | IntervalCandidate;

/** Legacy `user_id` candidates resolve to their linked Person, never by email. */
const resolveCandidatePeople = async (
  ctx: ConflictContext,
  candidates: readonly ConflictCandidateInput[],
): Promise<ConflictCandidateInput[]> => {
  const legacy = candidates.flatMap((candidate) => (!candidate.person_id && candidate.user_id ? [candidate.user_id] : []));
  if (legacy.length === 0) return [...candidates];
  const linked = await unwrap(
    ctx.db.from('people').select('id, profile_id').eq('organization_id', ctx.orgId).in('profile_id', legacy),
  );
  const byProfile = new Map((linked ?? []).map((person) => [person.profile_id, person.id]));
  return candidates.map((candidate) =>
    candidate.person_id ? candidate : { ...candidate, person_id: byProfile.get(candidate.user_id ?? '') ?? undefined },
  );
};

/** Typed, redacted conflicts for prospective requests. */
export const checkConflicts = async (
  ctx: ConflictContext,
  candidates: readonly CandidatePayload[],
  excludeAssignmentIds: readonly string[] = [],
): Promise<ConflictCheckResult> => {
  if (candidates.length === 0) return summarizeConflicts([]);
  const plain = candidates.filter((candidate): candidate is ConflictCandidateInput => !('intervals' in candidate));
  const withIntervals = candidates.filter((candidate): candidate is IntervalCandidate => 'intervals' in candidate);
  const resolved = await resolveCandidatePeople(ctx, plain);
  const unknown = resolved.filter((candidate) => !candidate.person_id);
  if (unknown.length > 0) throw HttpError.badRequest('Some people are not on this organization’s roster');

  const payload = [
    ...resolved.map((candidate, index) => ({
      key: candidate.key ?? `${candidate.person_id}:${candidate.plan_id}:${index}`,
      person_id: candidate.person_id,
      plan_id: candidate.plan_id,
      team_id: candidate.team_id ?? null,
      position_id: candidate.position_id ?? null,
      attendance_mode: candidate.attendance_mode,
      time_ids: candidate.time_ids,
    })),
    ...withIntervals,
  ];
  const rows = await unwrap(
    ctx.db.rpc('check_assignment_conflicts', {
      p_organization_id: ctx.orgId,
      p_candidates: payload,
      p_exclude_assignment_ids: [...excludeAssignmentIds],
    }),
  );
  return summarizeConflicts(((rows ?? []) as RawConflictRow[]).map(toConflict));
};

/** Only the blocking conflicts, the ones that need an override to commit. */
export const blockingConflicts = (result: ConflictCheckResult): AttendanceConflict[] =>
  result.conflicts.filter((conflict) => conflict.severity === 'blocking');

export interface PlanTimesContext {
  db: Db;
  orgId: string;
  planId: string;
}

/** Fills missing ids (legacy editors) without ever using list position as identity. */
export const identifyPlanTimes = async (
  ctx: PlanTimesContext,
  drafts: readonly PlanTimeDraft[],
): Promise<IdentifiedPlanTime[]> => {
  if (drafts.every((draft) => draft.id)) return assignLegacyTimeIds(drafts, [], randomUUID);
  const existing = ((await unwrap(
    ctx.db.from('plan_times').select('id, kind, starts_at, ends_at').eq('plan_id', ctx.planId),
  )) ?? []) as Array<Pick<PlanTimeRow, 'id' | 'kind' | 'starts_at' | 'ends_at'>>;
  return assignLegacyTimeIds(drafts, existing, randomUUID);
};

type RawImpact = Omit<PlanTimeImpact, 'conflicts'>;

/** Names and team labels for the requests a preview describes. */
const describeImpact = async (db: Db, assignments: readonly PlanTimeImpactAssignment[]): Promise<PlanTimeImpactAssignment[]> => {
  if (assignments.length === 0) return [];
  const personIds = [...new Set(assignments.map((assignment) => assignment.person_id))];
  const teamIds = [...new Set(assignments.flatMap((assignment) => (assignment.team_id ? [assignment.team_id] : [])))];
  const positionIds = [...new Set(assignments.flatMap((assignment) => (assignment.position_id ? [assignment.position_id] : [])))];
  const [people, teams, positions] = await Promise.all([
    inChunks(personIds, (ids) => unwrap(db.from('people_directory').select('id, first_name, last_name').in('id', ids))),
    teamIds.length ? unwrap(db.from('teams').select('id, name').in('id', teamIds)) : Promise.resolve([]),
    positionIds.length ? unwrap(db.from('team_positions').select('id, name').in('id', positionIds)) : Promise.resolve([]),
  ]);
  const names = new Map(((people ?? []) as PersonNameRow[]).map((person) => [person.id, personName(person)]));
  const teamNames = new Map((teams ?? []).map((team) => [team.id, team.name]));
  const positionNames = new Map((positions ?? []).map((position) => [position.id, position.name]));
  return assignments.map((assignment) => ({
    ...assignment,
    person_name: names.get(assignment.person_id) ?? 'Someone',
    team_name: assignment.team_id ? teamNames.get(assignment.team_id) ?? null : null,
    position_name: assignment.position_id ? positionNames.get(assignment.position_id) ?? null : null,
  }));
};

const toTimePayload = (times: readonly IdentifiedPlanTime[]) =>
  times.map((time) => ({
    id: time.id,
    kind: time.kind,
    name: time.name,
    starts_at: time.starts_at,
    ends_at: time.ends_at,
    sort_order: time.sort_order,
  }));

/**
 * What saving this full time list would do. The overlaps it would create are
 * informational (a time is a plan fact); they are checked through the same
 * resolver with the proposed intervals.
 */
export const previewPlanTimes = async (
  ctx: PlanTimesContext,
  times: readonly IdentifiedPlanTime[],
  canSchedule: boolean,
): Promise<PlanTimeImpact> => {
  const impact = (await unwrap(
    raw(ctx.db).rpc('preview_plan_time_changes', { p_plan_id: ctx.planId, p_times: toTimePayload(times) }),
  )) as RawImpact;
  const assignments = await describeImpact(ctx.db, impact.assignments);
  const candidates = impactConflictCandidates({ plan_id: ctx.planId, assignments }, times);
  const conflicts = canSchedule && candidates.length > 0
    ? (await checkConflicts(ctx, candidates, candidates.map((candidate) => candidate.key))).conflicts
    : [];
  return { ...impact, assignments, conflicts };
};

export interface ApplyPlanTimesInput {
  times: readonly IdentifiedPlanTime[];
  expectedRevision: number | null;
  impactHash: string | null;
  orphanResolutions: readonly OrphanResolutionInput[];
  notify: boolean;
  effectKey: string;
}

/** The plan columns a PATCH may change next to (or without) a time list. */
export type PlanFieldsPatch = Pick<
  UpdatePlanInput,
  'title' | 'service_type_id' | 'service_date' | 'location' | 'status' | 'notes'
>;

export interface UpdatePlanWithTimesInput extends Omit<ApplyPlanTimesInput, 'times'> {
  /** The full time list, or null to leave the times alone. */
  times: readonly IdentifiedPlanTime[] | null;
  fields: PlanFieldsPatch;
  /**
   * W10-CD-D1: moving people's times into an overlap needs the override
   * capability and this reason (audited like an assignment override).
   */
  conflictOverrideReason: string | null;
}

/**
 * Plan fields and (optionally) the time list in ONE transaction
 * (`update_plan_with_times`): a failure of either rolls back both. When both a
 * `service_date` and a time list with a service time are sent, the times win
 * (the plan date follows the earliest service time).
 */
export const updatePlanWithTimes = async (
  ctx: PlanTimesContext,
  input: UpdatePlanWithTimesInput,
): Promise<PlanTimeChangeResult | null> => {
  const result = (await unwrap(
    raw(ctx.db).rpc('update_plan_with_times', {
      p_plan_id: ctx.planId,
      p_fields: input.fields,
      p_times: input.times ? toTimePayload(input.times) : null,
      p_expected_revision: input.expectedRevision,
      p_impact_hash: input.impactHash,
      p_orphan_resolutions: [...input.orphanResolutions],
      p_notify: input.notify,
      p_effect_key: input.effectKey,
      p_conflict_override_reason: input.conflictOverrideReason,
    }),
  )) as (PlanTimeChangeResult & { impact?: RawImpact }) | null;
  if (!input.times || !result) return null;
  return {
    invalidated_requests: result.invalidated_requests,
    // ADR-0006: a draft plan records no effect, so nobody was re-asked.
    notified_assignment_ids: result.effect_id ? result.notified_assignment_ids ?? [] : [],
    effect_id: result.effect_id ?? null,
  };
};
