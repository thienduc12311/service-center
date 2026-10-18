import { z } from 'zod';
import { idempotencyKey, isoDateTime, uuid } from './common.js';
import { deliveryChannelSchema } from './delivery.js';

export const reminderKindSchema = z.enum(['pending_response', 'confirmed_service']);

/** `HH:MM` or `HH:MM:SS`, 24-hour local wall-clock time. */
const wallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Use a 24-hour HH:MM time');

/** The prepared requests a leader is reviewing for release (any number of plans). */
export const releaseBatchPreviewSchema = z.object({
  assignment_ids: z.array(uuid).min(1).max(500),
});

/**
 * Releases exactly the reviewed (assignment, revision) pairs, now or at
 * `scheduled_for`. One message per Person per batch; each plan keeps its own
 * response action.
 */
export const createReleaseBatchSchema = z
  .object({
    items: z
      .array(z.object({ assignment_id: uuid, request_revision: z.number().int().min(0) }))
      .min(1)
      .max(500)
      .refine((items) => new Set(items.map((item) => item.assignment_id)).size === items.length, {
        message: 'Each request may appear once',
      }),
    notify: z.boolean().default(true),
    scheduled_for: isoDateTime.nullable().optional(),
    idempotency_key: idempotencyKey,
  })
  .refine((v) => !v.scheduled_for || new Date(v.scheduled_for).getTime() <= Date.now() + 366 * 24 * 3600 * 1000, {
    message: 'Schedule at most a year ahead',
    path: ['scheduled_for'],
  });

export const listReleaseBatchesQuerySchema = z.object({
  status: z.enum(['scheduled', 'released', 'cancelled', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listPreparedRequestsQuerySchema = z.object({
  /** Upcoming plans only, within this many days (bounded). */
  days: z.coerce.number().int().min(1).max(366).default(90),
});

/** Scope of a reminder policy: organization (neither), a service type, or a team. */
export const reminderPolicyScopeQuerySchema = z
  .object({
    service_type_id: uuid.optional(),
    team_id: uuid.optional(),
  })
  .refine((v) => !(v.service_type_id && v.team_id), { message: 'Choose a service type or a team, not both' });

export const upsertReminderPolicySchema = z
  .object({
    service_type_id: uuid.nullable().optional(),
    team_id: uuid.nullable().optional(),
    kind: reminderKindSchema,
    enabled: z.boolean(),
    /** 15 minutes to 30 days before the first applicable time. */
    offset_minutes: z.number().int().min(15).max(43200),
    channels: z.array(deliveryChannelSchema).min(1).max(3)
      .refine((c) => new Set(c).size === c.length, { message: 'List each channel once' }),
    quiet_start: wallClock.nullable().default(null),
    quiet_end: wallClock.nullable().default(null),
    max_per_day: z.number().int().min(1).max(10).default(2),
    /** The revision the editor loaded; omit when creating. */
    expected_revision: z.number().int().min(1).optional(),
  })
  .refine((v) => !(v.service_type_id && v.team_id), { message: 'Choose a service type or a team, not both' })
  .refine((v) => (v.quiet_start === null) === (v.quiet_end === null), {
    message: 'Set both quiet-hours times or neither',
    path: ['quiet_end'],
  })
  .refine((v) => v.quiet_start === null || v.quiet_start.slice(0, 5) !== v.quiet_end?.slice(0, 5), {
    message: 'Quiet hours must start and end at different times',
    path: ['quiet_end'],
  });

export const updateReminderPreferencesSchema = z.object({
  email: z.boolean(),
  push: z.boolean(),
  in_app: z.boolean(),
});

export type ReleaseBatchPreviewInput = z.infer<typeof releaseBatchPreviewSchema>;
export type CreateReleaseBatchInput = z.infer<typeof createReleaseBatchSchema>;
export type CreateReleaseBatchRequest = z.input<typeof createReleaseBatchSchema>;
export type ListReleaseBatchesQuery = z.infer<typeof listReleaseBatchesQuerySchema>;
export type ListPreparedRequestsQuery = z.infer<typeof listPreparedRequestsQuerySchema>;
export type ReminderPolicyScopeQuery = z.infer<typeof reminderPolicyScopeQuerySchema>;
export type UpsertReminderPolicyInput = z.infer<typeof upsertReminderPolicySchema>;
export type UpsertReminderPolicyRequest = z.input<typeof upsertReminderPolicySchema>;
export type UpdateReminderPreferencesInput = z.infer<typeof updateReminderPreferencesSchema>;
