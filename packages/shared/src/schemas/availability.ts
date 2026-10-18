import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';
import { parseLocalDate, parseLocalTime } from '../lib/timezone.js';

const localDate = z.string().refine((value) => parseLocalDate(value) !== null, 'Choose a valid date');
const localTime = z.string().refine((value) => parseLocalTime(value.slice(0, 5)) !== null, 'Choose a valid time');
const weekOfMonth = z.number().int().min(1).max(5);

// ------------------------------------------------------------ preferences --

export const schedulingFrequencySchema = z.enum(['every_week', 'every_other_week', 'every_third_week', 'once_a_month']);

/** Save (create or replace) one preference scope: all teams, or one team. */
export const saveSchedulingPreferenceSchema = z.object({
  person_id: uuid.optional(),
  team_id: uuid.nullable().default(null),
  frequency: schedulingFrequencySchema.nullable().default(null),
  max_per_month: z.number().int().min(1).max(31).nullable().default(null),
  preferred_weeks: z.array(weekOfMonth).max(5).default([]),
  avoided_weeks: z.array(weekOfMonth).max(5).default([]),
  preferred_dates: z.array(localDate).max(60).default([]),
  avoided_dates: z.array(localDate).max(60).default([]),
  preferred_times: z.array(localTime).max(12).default([]),
  /** Omitted for a new scope; otherwise the revision the form was loaded at. */
  expected_revision: z.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (value.preferred_weeks.some((week) => value.avoided_weeks.includes(week))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['avoided_weeks'], message: 'A week cannot be both preferred and avoided' });
  }
  if (value.preferred_dates.some((date) => value.avoided_dates.includes(date))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['avoided_dates'], message: 'A date cannot be both preferred and avoided' });
  }
});

export const personScopeQuerySchema = z.object({ person_id: uuid.optional() });
export const affirmAvailabilitySchema = z.object({ person_id: uuid.optional() });

export const preferenceWarningsSchema = z.object({
  plan_id: uuid,
  team_id: uuid,
  person_ids: z.array(uuid).min(1).max(200),
  plan_time_ids: z.array(uuid).max(20).optional(),
});

// ------------------------------------------------- availability requests --

export const previewAvailabilityRequestSchema = z.object({ team_id: uuid });

export const createAvailabilityRequestSchema = z.object({
  team_id: uuid,
  /** Exactly the people reviewed in the preview. */
  person_ids: z.array(uuid).min(1).max(500),
  message: z.string().trim().max(1000).nullish(),
  window_start: localDate,
  window_end: localDate,
  respond_by: localDate.nullish(),
  idempotency_key: idempotencyKey,
}).refine((value) => value.window_end >= value.window_start, {
  message: 'The period must end on or after it starts', path: ['window_end'],
});

// ------------------------------------------------------------ delegation --

export const grantDelegationSchema = z.object({
  delegate_person_id: uuid,
  can_respond: z.boolean().default(false),
  can_view_schedule: z.boolean().default(false),
  can_manage_availability: z.boolean().default(false),
  can_signup: z.boolean().default(false),
  expires_at: z.string().datetime({ offset: true }).nullish(),
}).refine((value) => value.can_respond || value.can_view_schedule || value.can_manage_availability || value.can_signup, {
  message: 'Choose at least one thing they can help with', path: ['can_respond'],
});

export const delegatedRespondSchema = z.object({
  status: z.enum(['confirmed', 'declined']),
  expected_status: z.enum(['unconfirmed', 'confirmed', 'declined']),
  reason: z.string().trim().max(500).nullish(),
});

// ------------------------------------------------- across organizations --

export const scheduleSettingsSchema = z.object({
  combined_schedule: z.boolean(),
  share_busy_across_orgs: z.boolean(),
});

export const combinedScheduleQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
}).refine((value) => {
  const span = new Date(value.to).getTime() - new Date(value.from).getTime();
  return span > 0 && span <= 92 * 24 * 60 * 60 * 1000;
}, { message: 'Choose a window of at most 92 days', path: ['to'] });

export const copyAvailabilitySchema = z.object({
  /** Blockouts in the active organization, all belonging to you. */
  blockout_ids: z.array(uuid).min(1).max(50),
  target_organization_ids: z.array(uuid).min(1).max(10),
  /** Reasons stay private unless you choose to share them. */
  include_reason: z.boolean().default(false),
  idempotency_key: idempotencyKey,
});

export type SaveSchedulingPreferenceInput = z.infer<typeof saveSchedulingPreferenceSchema>;
export type SaveSchedulingPreferenceRequest = z.input<typeof saveSchedulingPreferenceSchema>;
export type PreferenceWarningsInput = z.infer<typeof preferenceWarningsSchema>;
export type PreviewAvailabilityRequestInput = z.infer<typeof previewAvailabilityRequestSchema>;
export type CreateAvailabilityRequestInput = z.infer<typeof createAvailabilityRequestSchema>;
export type GrantDelegationInput = z.infer<typeof grantDelegationSchema>;
export type GrantDelegationRequest = z.input<typeof grantDelegationSchema>;
export type DelegatedRespondInput = z.infer<typeof delegatedRespondSchema>;
export type ScheduleSettingsInput = z.infer<typeof scheduleSettingsSchema>;
export type CombinedScheduleQuery = z.infer<typeof combinedScheduleQuerySchema>;
export type CopyAvailabilityInput = z.infer<typeof copyAvailabilitySchema>;
export type CopyAvailabilityRequest = z.input<typeof copyAvailabilitySchema>;
