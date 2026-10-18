import { describe, expect, it } from 'vitest';
import {
  checkAssignmentConflictsSchema,
  conflictCandidateSchema,
  setAssignmentAttendanceSchema,
} from './attendance.js';
import { createAssignmentsSchema } from './assignment.js';
import { updatePlanSchema } from './plan.js';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('F04 attendance schemas', () => {
  it('needs a Person and at least one time in selected mode', () => {
    expect(conflictCandidateSchema.safeParse({ plan_id: ID }).success).toBe(false);
    expect(conflictCandidateSchema.safeParse({ person_id: ID, plan_id: ID, attendance_mode: 'selected' }).success).toBe(false);
    expect(conflictCandidateSchema.parse({ person_id: ID, plan_id: ID })).toMatchObject({ attendance_mode: 'all', time_ids: [] });
    expect(checkAssignmentConflictsSchema.parse({ candidates: [{ user_id: ID, plan_id: OTHER }] }).exclude_assignment_ids).toEqual([]);
  });

  it('keeps all-times and selected-times changes unambiguous', () => {
    const change = { assignment_id: ID, expected_request_revision: 2 };
    expect(setAssignmentAttendanceSchema.safeParse({ changes: [{ ...change, attendance_mode: 'all', time_ids: [OTHER] }] }).success).toBe(false);
    expect(setAssignmentAttendanceSchema.safeParse({ changes: [{ ...change, attendance_mode: 'selected' }] }).success).toBe(false);
    const parsed = setAssignmentAttendanceSchema.parse({ changes: [{ ...change, attendance_mode: 'selected', time_ids: [OTHER] }] });
    expect(parsed.notify).toBe(true);
    expect(setAssignmentAttendanceSchema.safeParse({ changes: [{ ...change, attendance_mode: 'all' }], conflict_override_reason: '   ' }).success).toBe(false);
  });

  it('accepts an override reason when scheduling and a previewed time edit', () => {
    const body = createAssignmentsSchema.parse({
      assignments: [{ person_id: ID, team_id: OTHER }],
      conflict_override_reason: '  Only the first half hour ',
    });
    expect(body.conflict_override_reason).toBe('Only the first half hour');
    expect(updatePlanSchema.safeParse({ time_impact_hash: 'not-a-hash' }).success).toBe(false);
    const update = updatePlanSchema.parse({
      time_impact_hash: 'a'.repeat(32),
      orphan_resolutions: [{ assignment_id: ID, action: 'remove' }],
    });
    expect(update.notify_time_changes).toBe(true);
    expect(update.orphan_resolutions).toHaveLength(1);
  });
});
