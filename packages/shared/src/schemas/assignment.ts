import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';

const visibility = z.enum(['prepared', 'released']);

export const assignmentStatusSchema = z.enum(['unconfirmed', 'confirmed', 'declined']);

export const createAssignmentsSchema = z.object({
  assignments: z
    .array(
      z
        .object({
          /** Canonical roster identity. */
          person_id: uuid.optional(),
          /** Compatibility input for older clients; resolved to an existing Person. */
          user_id: uuid.optional(),
          team_id: uuid,
          position_id: uuid.nullish(),
          notes: z.string().trim().max(1000).nullish(),
          /** Overrides `visibility` for this row. */
          visibility: visibility.optional(),
          attendance_mode: z.enum(['all', 'selected']).default('all'),
          time_ids: z.array(uuid).max(20).default([]),
        })
        .refine((value) => Boolean(value.person_id || value.user_id), {
          message: 'Choose a Person',
          path: ['person_id'],
        })
        .refine((value) => value.attendance_mode === 'all' || value.time_ids.length > 0, {
          message: 'Choose at least one attendance time',
          path: ['time_ids'],
        }),
    )
    .min(1)
    .max(200),
  /**
   * `prepared` keeps the requests private to schedulers until released.
   * Omitted: each team's default (released unless the team says otherwise).
   */
  visibility: visibility.optional(),
  /** Who hears the answers; must schedule those teams. Defaults to the team's owner, then you. */
  response_owner_id: uuid.optional(),
  /** Schedule anyway when the person is blocked out or double booked. */
  ignore_conflicts: z.boolean().default(false),
  /**
   * Why the scheduler proceeds despite preference warnings (F03). Warnings
   * never block; when any apply, they are recorded with this optional reason.
   */
  preference_override_reason: z.string().trim().max(500).nullish(),
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

export const previewAssignmentResponsesSchema = z.object({
  assignment_ids: z.array(uuid).min(1).max(500),
});

export const assignmentSnapshotAnswerSchema = z
  .object({
    assignment_id: uuid,
    /** Null only for a genuinely untimed legacy plan. */
    plan_time_id: uuid.nullable(),
    status: responseStatus,
    reason: responseReason,
  })
  .refine(reasonOnlyWithDecline, reasonOnlyWithDeclineIssue);

export const respondToAssignmentSnapshotsSchema = z.object({
  responses: z
    .array(
      z.object({
        snapshot_id: uuid,
        version: z.number().int().positive(),
        answers: z.array(assignmentSnapshotAnswerSchema).min(1).max(2000),
      }),
    )
    .min(1)
    .max(100),
  idempotency_key: idempotencyKey,
});

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
export type PreviewAssignmentResponsesInput = z.infer<typeof previewAssignmentResponsesSchema>;
export type RespondToAssignmentSnapshotsInput = z.infer<typeof respondToAssignmentSnapshotsSchema>;
export type RespondToAssignmentSnapshotsRequest = z.input<typeof respondToAssignmentSnapshotsSchema>;
export type ConflictCheckInput = z.infer<typeof conflictCheckSchema>;
