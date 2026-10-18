import { z } from 'zod';
import { conflictOverrideReason, idempotencyKey, musicalKey, nonEmpty, uuid } from './common.js';
import { planItemTypeSchema, planTimeKindSchema } from './plan.js';

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const nullableText = (max: number) =>
  z.string().trim().max(max).nullish().transform((value) => (value ? value : null));

export const planTemplateKindSchema = z.enum(['plan', 'section']);
export const planTemplateComponentSchema = z.enum(['times', 'notes', 'items', 'needs', 'roster']);
export const templateApplyModeSchema = z.enum(['append', 'replace']);
/** Which instant a wall-clock time that occurs twice (DST fall-back) means. */
export const ambiguousTimeSchema = z.enum(['earlier', 'later']);

const components = z
  .array(planTemplateComponentSchema)
  .min(1, 'Choose at least one part of the template')
  .max(5)
  .transform((values) => [...new Set(values)].sort());

export const planTemplateTimeSchema = z.object({
  kind: planTimeKindSchema.default('service'),
  name: nullableText(120),
  day_offset: z.number().int().min(-14).max(14).default(0),
  local_start: localTime,
  duration_minutes: z.number().int().min(1).max(1440),
});

export const planTemplateItemSchema = z
  .object({
    item_type: planItemTypeSchema.default('item'),
    title: nullableText(200),
    song_id: uuid.nullish().transform((value) => value ?? null),
    arrangement_id: uuid.nullish().transform((value) => value ?? null),
    key_override: musicalKey.nullish().transform((value) => value || null),
    length_seconds: z.number().int().min(0).max(36_000).default(0),
    description: nullableText(4000),
  })
  .refine((v) => v.item_type !== 'song' || Boolean(v.song_id), { message: 'A song item needs a song', path: ['song_id'] })
  .refine((v) => v.item_type === 'song' || Boolean(v.title), { message: 'Title is required', path: ['title'] });

export const planTemplateNeedSchema = z.object({
  position_id: uuid,
  needed: z.number().int().min(1).max(99),
});

export const planTemplateRosterEntrySchema = z.object({
  person_id: uuid,
  team_id: uuid,
  position_id: uuid.nullish().transform((value) => value ?? null),
});

/** Template content; references are checked against the organization by the database. */
export const planTemplateContentSchema = z
  .object({
    version: z.literal(1).default(1),
    notes: nullableText(8000),
    times: z.array(planTemplateTimeSchema).max(20).default([]),
    items: z.array(planTemplateItemSchema).max(200).default([]),
    needs: z.array(planTemplateNeedSchema).max(200).default([]),
    roster: z.array(planTemplateRosterEntrySchema).max(200).default([]),
  })
  .strict();

/** Snapshot the chosen parts of a real plan instead of sending content. */
export const planTemplateSourceSchema = z.object({
  plan_id: uuid,
  components,
});

export const createPlanTemplateSchema = z
  .object({
    kind: planTemplateKindSchema.default('plan'),
    service_type_id: uuid.nullish().transform((value) => value ?? null),
    name: nonEmpty.max(120),
    description: nullableText(2000),
    content: planTemplateContentSchema.optional(),
    source: planTemplateSourceSchema.optional(),
  })
  .refine((v) => Boolean(v.content) !== Boolean(v.source), {
    message: 'Send either content or a plan to copy from',
    path: ['content'],
  });

/** A content or source change makes a new revision; name/description do not. */
export const updatePlanTemplateSchema = z
  .object({
    expected_revision: z.number().int().min(1),
    name: nonEmpty.max(120).optional(),
    description: z.string().trim().max(2000).nullish(),
    content: planTemplateContentSchema.optional(),
    source: planTemplateSourceSchema.optional(),
  })
  .refine((v) => !(v.content && v.source), { message: 'Send either content or a plan, not both', path: ['content'] });

export const archivePlanTemplateSchema = z.object({ archived: z.boolean() });

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const listPlanTemplatesQuerySchema = z.object({
  kind: planTemplateKindSchema.optional(),
  service_type_id: uuid.optional(),
  include_archived: booleanQuery.default(false),
});

export const previewTemplateApplySchema = z.object({
  revision_id: uuid,
  mode: templateApplyModeSchema.default('append'),
  components,
  /** Items only, append only: 0 puts them first. Omitted: at the end. */
  insert_at: z.number().int().min(0).max(500).nullish().transform((value) => value ?? null),
  ambiguous_time: ambiguousTimeSchema.default('earlier'),
});

export const applyTemplateSchema = previewTemplateApplySchema.extend({
  preview_hash: z.string().regex(/^[0-9a-f]{32}$/, 'Preview the template again'),
  /** The plan's `content_revision` the preview was made against. */
  expected_revision: z.number().int().min(0),
  idempotency_key: idempotencyKey.optional(),
  conflict_override_reason: conflictOverrideReason.nullish(),
});

/** Changes to one proposed date before anything is created. */
export const generationDateEditSchema = z.object({
  local_date: localDate,
  skip: z.boolean().default(false),
  move_to: localDate.optional(),
  title: z.string().trim().min(1).max(200).optional(),
});

/** A bounded local-date series: weekly every N weeks, finite count or end date. */
export const planSeriesSchema = z
  .object({
    revision_id: uuid,
    /** Times are always created; choose which other parts to copy. */
    components: z
      .array(planTemplateComponentSchema)
      .max(5)
      .default(['items', 'needs', 'notes'])
      .transform((values) => [...new Set([...values, 'times' as const])].sort()),
    start_date: localDate,
    interval_weeks: z.number().int().min(1).max(4).default(1),
    count: z.number().int().min(1).max(12).default(4),
    end_date: localDate.optional(),
    excluded_dates: z.array(localDate).max(52).default([]),
    edits: z.array(generationDateEditSchema).max(12).default([]),
    title: z.string().trim().min(1).max(200).optional(),
    ambiguous_time: ambiguousTimeSchema.default('earlier'),
  })
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { message: 'End after the start date', path: ['end_date'] });

export const generatePlansSchema = planSeriesSchema.and(
  z.object({
    preview_hash: z.string().regex(/^[0-9a-f]{32}$/, 'Preview the plans again'),
    idempotency_key: idempotencyKey,
    conflict_override_reason: conflictOverrideReason.nullish(),
  }),
);

export type PlanTemplateContentInput = z.infer<typeof planTemplateContentSchema>;
export type PlanTemplateContentRequest = z.input<typeof planTemplateContentSchema>;
export type CreatePlanTemplateInput = z.infer<typeof createPlanTemplateSchema>;
export type CreatePlanTemplateRequest = z.input<typeof createPlanTemplateSchema>;
export type UpdatePlanTemplateInput = z.infer<typeof updatePlanTemplateSchema>;
export type UpdatePlanTemplateRequest = z.input<typeof updatePlanTemplateSchema>;
export type ArchivePlanTemplateInput = z.infer<typeof archivePlanTemplateSchema>;
export type ListPlanTemplatesQuery = z.infer<typeof listPlanTemplatesQuerySchema>;
export type ListPlanTemplatesRequest = z.input<typeof listPlanTemplatesQuerySchema>;
export type PreviewTemplateApplyInput = z.infer<typeof previewTemplateApplySchema>;
export type PreviewTemplateApplyRequest = z.input<typeof previewTemplateApplySchema>;
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;
export type ApplyTemplateRequest = z.input<typeof applyTemplateSchema>;
export type GenerationDateEdit = z.infer<typeof generationDateEditSchema>;
export type PlanSeriesInput = z.infer<typeof planSeriesSchema>;
export type PlanSeriesRequest = z.input<typeof planSeriesSchema>;
export type GeneratePlansInput = z.infer<typeof generatePlansSchema>;
export type GeneratePlansRequest = z.input<typeof generatePlansSchema>;
export type AmbiguousTimeChoice = z.infer<typeof ambiguousTimeSchema>;

// ------------------------------------------------- F10 Pass C: reschedule --

export const rescheduleModeSchema = z.enum(['shift', 'order_only']);

export const planMoveSchema = z.object({
  plan_id: uuid,
  /** The plan's new local service date; its times keep their local clock. */
  new_date: localDate,
});

const shiftRescheduleSchema = z.object({
  mode: z.literal('shift'),
  moves: z
    .array(planMoveSchema)
    .min(1)
    .max(12)
    .refine((moves) => new Set(moves.map((move) => move.plan_id)).size === moves.length, 'A plan is listed twice'),
  /** Never implied: confirmed/declined released answers become unconfirmed only when true. */
  reset_responses: z.boolean().default(false),
  /** Re-send requests with the new time to released people (F04). */
  notify: z.boolean().default(true),
  ambiguous_time: ambiguousTimeSchema.default('earlier'),
});

const orderOnlyRescheduleSchema = z.object({
  mode: z.literal('order_only'),
  source_plan_id: uuid,
  destination_plan_id: uuid,
  items_mode: templateApplyModeSchema.default('append'),
  remove_from_source: z.boolean().default(true),
});

export const reschedulePreviewSchema = z.discriminatedUnion('mode', [shiftRescheduleSchema, orderOnlyRescheduleSchema]);

export const rescheduleCommitSchema = reschedulePreviewSchema.and(
  z.object({
    preview_hash: z.string().regex(/^[0-9a-f]{32}$/, 'Review the change again'),
    idempotency_key: idempotencyKey,
    conflict_override_reason: conflictOverrideReason.nullish(),
  }),
);

export type RescheduleMode = z.infer<typeof rescheduleModeSchema>;
export type PlanMoveInput = z.infer<typeof planMoveSchema>;
export type ReschedulePreviewInput = z.infer<typeof reschedulePreviewSchema>;
export type ReschedulePreviewRequest = z.input<typeof reschedulePreviewSchema>;
export type RescheduleCommitInput = z.infer<typeof rescheduleCommitSchema>;
export type RescheduleCommitRequest = z.input<typeof rescheduleCommitSchema>;
