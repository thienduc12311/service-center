import { z } from 'zod';
import { uuid } from './common.js';
import { isValidTimeZone, parseLocalDate, parseLocalTime } from '../lib/timezone.js';

const localDateSchema = z.string().refine((value) => parseLocalDate(value) !== null, 'Choose a valid date');
const localTimeSchema = z.string().refine((value) => parseLocalTime(value) !== null, 'Choose a valid time');
const timeZoneSchema = z.string().max(100).refine(isValidTimeZone, 'Choose a valid IANA timezone');

export const blockoutIntentSchema = z.object({
  person_id: uuid.optional(),
  all_day: z.boolean(),
  timezone: timeZoneSchema,
  local_start_date: localDateSchema,
  local_start_time: localTimeSchema.nullish(),
  local_end_date: localDateSchema,
  local_end_time: localTimeSchema.nullish(),
  ambiguous_time_policy: z.enum(['earlier', 'later']),
  reason: z.string().trim().max(200).nullish(),
}).superRefine((value, context) => {
  if (!value.all_day && (!value.local_start_time || !value.local_end_time)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['local_start_time'], message: 'Timed blockouts need start and end times' });
  }
  if (value.all_day && value.local_end_date <= value.local_start_date) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['local_end_date'], message: 'All-day end date is the exclusive following date' });
  }
});

export const createBlockoutSchema = blockoutIntentSchema.and(z.object({
  idempotency_key: z.string().uuid().optional(),
}));

export const updateBlockoutSchema = blockoutIntentSchema.and(z.object({
  expected_revision: z.number().int().min(0),
}));

export const blockoutRecurrenceSchema = z.object({
  frequency: z.enum(['weekly', 'monthly']),
  interval: z.number().int().min(1).max(12),
  end: z.discriminatedUnion('type', [
    z.object({ type: z.literal('count'), count: z.number().int().min(1).max(120) }),
    z.object({ type: z.literal('until'), until_date: localDateSchema }),
  ]),
  monthly_missing_date: z.literal('skip').default('skip'),
});

export const previewBlockoutSeriesSchema = blockoutIntentSchema.and(z.object({
  recurrence: blockoutRecurrenceSchema,
}));

export const createBlockoutSeriesSchema = previewBlockoutSeriesSchema.and(z.object({
  idempotency_key: z.string().uuid(),
}));

export const maintainBlockoutSeriesSchema = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('occurrence'),
    occurrence_id: uuid,
    expected_series_revision: z.number().int().min(0),
    idempotency_key: z.string().uuid(),
    action: z.enum(['update', 'delete']),
    replacement: blockoutIntentSchema.optional(),
  }),
  z.object({
    scope: z.literal('future'),
    occurrence_id: uuid,
    expected_series_revision: z.number().int().min(0),
    idempotency_key: z.string().uuid(),
    action: z.enum(['update', 'delete']),
    replacement: previewBlockoutSeriesSchema.optional(),
  }),
  z.object({
    scope: z.literal('series'),
    expected_series_revision: z.number().int().min(0),
    idempotency_key: z.string().uuid(),
    action: z.enum(['update', 'delete']),
    replacement: previewBlockoutSeriesSchema.optional(),
  }),
]).superRefine((value, context) => {
  if (value.action === 'update' && !value.replacement) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['replacement'], message: 'Provide the updated blockout details' });
  }
});

export const affectedAssignmentsPreviewSchema = z.object({
  occurrences: z.array(z.object({ starts_at: z.string().datetime(), ends_at: z.string().datetime() })).min(1).max(120),
  person_id: uuid.optional(),
});

/** Legacy timestamp-only create remains accepted during the compatible transition. */
export const legacyBlockoutSchema = z.object({
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  reason: z.string().trim().max(200).nullish(),
  user_id: uuid.optional(),
}).refine((value) => new Date(value.starts_at) < new Date(value.ends_at), {
  message: 'End must be after start',
  path: ['ends_at'],
});

export const blockoutSchema = z.union([createBlockoutSchema, legacyBlockoutSchema]);

export type BlockoutIntentInput = z.infer<typeof blockoutIntentSchema>;
export type CreateBlockoutInput = z.infer<typeof createBlockoutSchema>;
export type UpdateBlockoutInput = z.infer<typeof updateBlockoutSchema>;
export type BlockoutRecurrenceInput = z.infer<typeof blockoutRecurrenceSchema>;
export type PreviewBlockoutSeriesInput = z.infer<typeof previewBlockoutSeriesSchema>;
export type CreateBlockoutSeriesInput = z.infer<typeof createBlockoutSeriesSchema>;
export type MaintainBlockoutSeriesInput = z.infer<typeof maintainBlockoutSeriesSchema>;
export type AffectedAssignmentsPreviewInput = z.infer<typeof affectedAssignmentsPreviewSchema>;
