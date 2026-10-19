import {
  canAccess,
  type AssignmentStatus,
  type AttendanceMarkInput,
  type AttendanceMarkRpc,
  type AttendanceSheetRoleInput,
  type AttendanceTimeOption,
  type EffectiveAccess,
  type PlanTimeKind,
} from '@service-center/shared';
import { personName, type PersonNameRow } from './availability.model.js';

/** A released request on the plan, as the attendance sheet reads it. */
export interface AttendanceAssignmentRow {
  id: string;
  person_id: string;
  team_id: string;
  status: AssignmentStatus;
  team: { name: string } | null;
  position: { name: string } | null;
}

export interface AttendancePersonRow extends PersonNameRow {
  archived_at: string | null;
}

export interface AttendancePlanTimeRow {
  id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

/**
 * The time a sheet opens on when none is asked for: the first time that has
 * not ended yet, else the last one.
 */
export const defaultAttendanceTime = (
  times: readonly AttendancePlanTimeRow[],
  nowMs: number,
): AttendancePlanTimeRow | null => times.find((time) => Date.parse(time.ends_at) >= nowMs) ?? times.at(-1) ?? null;

export const toAttendanceTimeOption = (time: AttendancePlanTimeRow): AttendanceTimeOption => ({
  id: time.id,
  kind: time.kind,
  name: time.name,
  starts_at: time.starts_at,
  ends_at: time.ends_at,
});

/** Leaders of the whole plan see every row; others only teams they schedule. */
export const seesWholePlan = (access: EffectiveAccess, serviceTypeId: string | null): boolean =>
  canAccess(access, 'plans.edit', { serviceTypeId }) || canAccess(access, 'scheduling.manage', { serviceTypeId });

export const canMarkTeam = (access: EffectiveAccess, serviceTypeId: string | null, teamId: string): boolean =>
  canAccess(access, 'scheduling.manage', { serviceTypeId, teamId });

/** Released requests covering the time → one sheet role each (UX `can_mark` from effective access). */
export const toSheetRoles = (
  assignments: readonly AttendanceAssignmentRow[],
  coveringIds: ReadonlySet<string>,
  people: ReadonlyMap<string, AttendancePersonRow>,
  access: EffectiveAccess,
  serviceTypeId: string | null,
): AttendanceSheetRoleInput[] =>
  assignments
    .filter((assignment) => coveringIds.has(assignment.id))
    .map((assignment) => {
      const person = people.get(assignment.person_id);
      return {
        assignment_id: assignment.id,
        person_id: assignment.person_id,
        person_name: personName(person),
        archived: Boolean(person?.archived_at),
        team_id: assignment.team_id,
        team_name: assignment.team?.name ?? 'Team',
        position_name: assignment.position?.name ?? null,
        response: assignment.status,
        can_mark: canMarkTeam(access, serviceTypeId, assignment.team_id),
      };
    });

export const toAttendanceMarkRpc = (mark: AttendanceMarkInput): AttendanceMarkRpc => ({
  person_id: mark.person_id,
  team_id: mark.team_id,
  status: mark.status,
  expected_revision: mark.expected_revision,
});
