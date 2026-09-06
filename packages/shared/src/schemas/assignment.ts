import { z } from 'zod';
import { uuid } from './common.js';

export const assignmentStatusSchema = z.enum(['unconfirmed', 'confirmed', 'declined']);

export const createAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        user_id: uuid,
        team_id: uuid,
        position_id: uuid.nullish(),
        notes: z.string().trim().max(1000).nullish(),
      }),
    )
    .min(1)
    .max(200),
  /** Schedule anyway when the person is blocked out or double booked. */
  ignore_conflicts: z.boolean().default(false),
  notify: z.boolean().default(true),
});

export const respondToAssignmentSchema = z.object({
  status: z.enum(['confirmed', 'declined']),
  notes: z.string().trim().max(1000).nullish(),
});

export const respondToAssignmentNotificationSchema = respondToAssignmentSchema;

export const updateAssignmentSchema = z.object({
  status: assignmentStatusSchema.optional(),
  position_id: uuid.nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const conflictCheckSchema = z.object({
  starts_at: z.string(),
  ends_at: z.string(),
  user_ids: z.array(uuid).min(1).max(200),
});

export type CreateAssignmentsInput = z.infer<typeof createAssignmentsSchema>;
export type RespondToAssignmentInput = z.infer<typeof respondToAssignmentSchema>;
export type RespondToAssignmentNotificationInput = z.infer<typeof respondToAssignmentNotificationSchema>;
export type ConflictCheckInput = z.infer<typeof conflictCheckSchema>;
