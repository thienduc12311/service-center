import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';

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
  /** Retrying with the same key never enqueues a second notification. */
  idempotency_key: idempotencyKey.optional(),
});

/** Matches the `assignments_response_note_length` database constraint. */
export const ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH = 500;

const responseStatus = z.enum(['confirmed', 'declined']);

/** Optional; blank input is stored as no reason at all. */
const responseReason = z
  .string()
  .trim()
  .max(ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH, `Keep the reason under ${ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH} characters`)
  .nullish()
  .transform((value) => value || null);

const reasonOnlyWithDecline = (body: { status: 'confirmed' | 'declined'; reason: string | null }) =>
  body.status === 'declined' || body.reason === null;
const reasonOnlyWithDeclineIssue = { message: 'A reason can only accompany a decline', path: ['reason'] };

export const respondToAssignmentSchema = z
  .object({
    status: responseStatus,
    reason: responseReason,
    /**
     * The status the person was looking at when they answered. When it no
     * longer matches, the server refuses with 409 instead of, say, turning a
     * plain decline into an unreviewed withdrawal of a confirmation made
     * elsewhere.
     */
    expected_status: assignmentStatusSchema.optional(),
  })
  .refine(reasonOnlyWithDecline, reasonOnlyWithDeclineIssue);

/** Respond links carry only the answer; reasons are given in the app. */
export const respondToAssignmentNotificationSchema = z.object({ status: responseStatus });

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
/** What a client sends; `reason` may be omitted or blank. */
export type RespondToAssignmentRequest = z.input<typeof respondToAssignmentSchema>;
export type RespondToAssignmentNotificationInput = z.infer<typeof respondToAssignmentNotificationSchema>;
export type RespondToAssignmentNotificationRequest = z.input<typeof respondToAssignmentNotificationSchema>;
export type ConflictCheckInput = z.infer<typeof conflictCheckSchema>;
