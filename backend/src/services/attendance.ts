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
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
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

/**
 * F04: the one attendance resolver, read through the caller's RLS (or the
 * service role for the feed). Every surface that shows "which times" uses it.
 */
export const attendanceFor = async (
  db: Db,
  assignmentIds: readonly string[],
): Promise<Map<string, AttendanceInterval[]>> => {
  if (assignmentIds.length === 0) return new Map();
  const rows: AttendanceInterval[] = [];
  for (let start = 0; start < assignmentIds.length; start += 2000) {
    const chunk = assignmentIds.slice(start, start + 2000);
    const data = await unwrap(db.rpc('assignment_attendance_for', { p_assignment_ids: [...chunk] }));
    rows.push(...((data ?? []) as AttendanceInterval[]));
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
    unwrap(db.from('people_directory').select('id, first_name, last_name').in('id', personIds)),
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

/** Commits the time list atomically: times, selections, stale requests and re-sends. */
export const applyPlanTimes = async (
  ctx: PlanTimesContext,
  input: ApplyPlanTimesInput,
): Promise<PlanTimeChangeResult> => {
  const result = (await unwrap(
    raw(ctx.db).rpc('apply_plan_time_changes', {
      p_plan_id: ctx.planId,
      p_times: toTimePayload(input.times),
      p_expected_revision: input.expectedRevision,
      p_impact_hash: input.impactHash,
      p_orphan_resolutions: [...input.orphanResolutions],
      p_notify: input.notify,
      p_effect_key: input.effectKey,
    }),
  )) as PlanTimeChangeResult & { impact: RawImpact };
  return {
    invalidated_requests: result.invalidated_requests,
    notified_assignment_ids: result.notified_assignment_ids ?? [],
    effect_id: result.effect_id ?? null,
  };
};
