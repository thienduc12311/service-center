import { z } from 'zod';
import { conflictOverrideReason, idempotencyKey, uuid } from './common.js';
import { planTimeSchema } from './plan.js';

export const attendanceModeSchema = z.enum(['all', 'selected']);

/**
 * One prospective request to check: who, on which plan, for which times.
 * `team_id`/`position_id` let the check skip the identical request already on
 * the plan. `user_id` is the legacy Profile identity, resolved to its Person.
 */
export const conflictCandidateSchema = z
  .object({
    key: z.string().trim().min(1).max(100).optional(),
    person_id: uuid.optional(),
    user_id: uuid.optional(),
    plan_id: uuid,
    team_id: uuid.nullish(),
    position_id: uuid.nullish(),
    attendance_mode: attendanceModeSchema.default('all'),
    time_ids: z.array(uuid).max(20).default([]),
  })
  .refine((value) => Boolean(value.person_id || value.user_id), {
    message: 'Choose a Person',
    path: ['person_id'],
  })
  .refine((value) => value.attendance_mode === 'all' || value.time_ids.length > 0, {
    message: 'Choose at least one attendance time',
    path: ['time_ids'],
  });

export const checkAssignmentConflictsSchema = z.object({
  candidates: z.array(conflictCandidateSchema).min(1).max(200),
  /** The requests being edited; never conflicts with themselves. */
  exclude_assignment_ids: z.array(uuid).max(500).default([]),
});

/** Change which times existing requests cover, with the revisions you saw. */
export const setAssignmentAttendanceSchema = z.object({
  changes: z
    .array(
      z
        .object({
          assignment_id: uuid,
          expected_request_revision: z.number().int().min(0),
          attendance_mode: attendanceModeSchema,
          time_ids: z.array(uuid).max(20).default([]),
        })
        .refine((value) => value.attendance_mode === 'all' || value.time_ids.length > 0, {
          message: 'Choose at least one attendance time',
          path: ['time_ids'],
        })
        .refine((value) => value.attendance_mode === 'selected' || value.time_ids.length === 0, {
          message: 'All-times requests do not list times',
          path: ['time_ids'],
        }),
    )
    .min(1)
    .max(200),
  conflict_override_reason: conflictOverrideReason.nullish(),
  /** Re-send released requests whose times changed (default). */
  notify: z.boolean().default(true),
  idempotency_key: idempotencyKey.optional(),
});

/** The complete proposed time list, every existing time with its id. */
export const previewPlanTimesSchema = z.object({
  times: z.array(planTimeSchema).max(20),
});

export type ConflictCandidateInput = z.infer<typeof conflictCandidateSchema>;
export type CheckAssignmentConflictsInput = z.infer<typeof checkAssignmentConflictsSchema>;
export type CheckAssignmentConflictsRequest = z.input<typeof checkAssignmentConflictsSchema>;
export type SetAssignmentAttendanceInput = z.infer<typeof setAssignmentAttendanceSchema>;
export type SetAssignmentAttendanceRequest = z.input<typeof setAssignmentAttendanceSchema>;
export type PreviewPlanTimesInput = z.infer<typeof previewPlanTimesSchema>;
