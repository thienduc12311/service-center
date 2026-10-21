import { z } from 'zod';
import { conflictOverrideReason, idempotencyKey, musicalKey, nonEmpty, paginationSchema, uuid } from './common.js';

export const planStatusSchema = z.enum(['draft', 'published', 'archived']);
export const planTimeKindSchema = z.enum(['service', 'rehearsal', 'other']);
export const planItemTypeSchema = z.enum(['song', 'header', 'item']);

export const planTimeSchema = z
  .object({
    /** Stable identity on edits; omitted only while creating a new plan. */
    id: uuid.optional(),
    kind: planTimeKindSchema.default('service'),
    name: z.string().trim().max(120).nullish(),
    starts_at: z.string(),
    ends_at: z.string(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((v) => new Date(v.starts_at) < new Date(v.ends_at), {
    message: 'End must be after start',
    path: ['ends_at'],
  });

export const createPlanSchema = z.object({
  title: nonEmpty.max(200),
  service_type_id: uuid.nullish(),
  service_date: z.string(),
  location: z.string().trim().max(200).nullish(),
  status: planStatusSchema.default('draft'),
  notes: z.string().trim().max(8000).nullish(),
  times: z.array(planTimeSchema).max(20).default([]),
  /** Copy items and (optionally) the team from an existing plan. */
  copy_from_plan_id: uuid.optional(),
  copy_assignments: z.boolean().default(false),
  idempotency_key: idempotencyKey.optional(),
  /** Copy the team over a scheduling conflict (F04); needs the override capability. */
  conflict_override_reason: conflictOverrideReason.nullish(),
});

/** F04: what happens to a selected request whose only times are removed. */
export const orphanResolutionSchema = z.object({
  assignment_id: uuid,
  /** `all`: keep the request for every time. `remove`: withdraw it. */
  action: z.enum(['all', 'remove']),
});

export const impactHashSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Preview the change again');

export const updatePlanSchema = createPlanSchema
  .partial()
  .omit({ copy_from_plan_id: true, copy_assignments: true, idempotency_key: true, conflict_override_reason: true })
  .extend({
    expected_revision: z.number().int().min(0).optional(),
    /**
     * F04: the `impact_hash` from `POST /plans/:id/times/preview`. Required to
     * remove a time someone selected; a changed impact is a 409.
     */
    time_impact_hash: impactHashSchema.optional(),
    orphan_resolutions: z.array(orphanResolutionSchema).max(200).default([]),
    /** Re-send affected released requests after a time change (default). */
    notify_time_changes: z.boolean().default(true),
  });

/** "Same as last week": a new draft plan copied from an existing one. */
export const duplicatePlanSchema = z.object({
  service_date: z.string(),
  title: z.string().trim().min(1).max(200).optional(),
  copy_assignments: z.boolean().default(true),
  idempotency_key: idempotencyKey.optional(),
  conflict_override_reason: conflictOverrideReason.nullish(),
});

/**
 * Copies another plan's order, needs and/or team into an existing plan in one
 * transaction. Nothing already on the plan is removed. `expected_revision` is
 * the plan's `content_revision` when it was read; a newer one is a 409.
 */
export const importPlanContentsSchema = z
  .object({
    source_plan_id: uuid,
    items: z.boolean().default(true),
    position_needs: z.boolean().default(false),
    assignments: z.boolean().default(false),
    expected_revision: z.number().int().min(0).optional(),
    idempotency_key: idempotencyKey.optional(),
    conflict_override_reason: conflictOverrideReason.nullish(),
  })
  .refine((v) => v.items || v.position_needs || v.assignments, {
    message: 'Choose at least one thing to import',
    path: ['items'],
  });

export const planItemSegmentSchema = z.enum(['pre', 'service', 'post']);

/**
 * F11: this plan's section order for a song. Null inherits the arrangement's
 * sequence; an empty list is "no sequence" for this plan only.
 */
export const sequenceOverrideSchema = z.array(nonEmpty.max(20)).max(60).nullable();

/** Plan-level item fields shared by create and edit. */
const planItemFields = {
  song_id: uuid.nullish(),
  arrangement_id: uuid.nullish(),
  key_override: musicalKey.nullish(),
  sequence_override: sequenceOverrideSchema.optional(),
  description: z.string().trim().max(4000).nullish(),
  /** F11: a named Person leads the item… */
  leader_person_id: uuid.nullish(),
  /** …or whoever holds this position on the plan. Never both. */
  leader_position_id: uuid.nullish(),
  service_segment: planItemSegmentSchema.optional(),
};

const oneLeader = (v: { leader_person_id?: string | null; leader_position_id?: string | null }) =>
  !(v.leader_person_id && v.leader_position_id);

export const createPlanItemSchema = z
  .object({
    ...planItemFields,
    item_type: planItemTypeSchema.default('item'),
    title: nonEmpty.max(200).optional(),
    length_seconds: z.number().int().min(0).max(36_000).default(0),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((v) => v.item_type !== 'song' || Boolean(v.song_id), {
    message: 'A song item needs a song_id',
    path: ['song_id'],
  })
  .refine((v) => v.item_type === 'song' || Boolean(v.title), {
    message: 'Title is required',
    path: ['title'],
  })
  .refine(oneLeader, { message: 'Choose a person or a position to lead, not both', path: ['leader_position_id'] });

/**
 * F11: edits an existing item in place (same id and position). Absent fields
 * are kept; null clears. `expected_revision` is the plan's `content_revision`
 * when the editor opened; a newer one is a 409 `plan_revision_stale`.
 */
export const updatePlanItemSchema = z
  .object({
    ...planItemFields,
    item_type: planItemTypeSchema.optional(),
    title: nonEmpty.max(200).optional(),
    length_seconds: z.number().int().min(0).max(36_000).optional(),
    expected_revision: z.number().int().min(0).optional(),
  })
  .refine(oneLeader, { message: 'Choose a person or a position to lead, not both', path: ['leader_position_id'] })
  .refine((v) => v.item_type === undefined || v.item_type === 'song' || (!v.arrangement_id && !v.sequence_override), {
    message: 'Only a song item has an arrangement or sequence',
    path: ['item_type'],
  });

/** Full ordering after a move, sent as the ids in their new order. */
export const reorderPlanItemsSchema = z.object({
  item_ids: z.array(uuid).min(1).max(500),
  expected_revision: z.number().int().min(0).optional(),
});

/** `DELETE /plans/:id/items/:itemId?expected_revision=` */
export const deletePlanItemQuerySchema = z.object({
  expected_revision: z.coerce.number().int().min(0).optional(),
});

/** F11: which service time a running order is timed against. */
export const planScheduleQuerySchema = z.object({
  time_id: uuid.optional(),
});

/**
 * How many people a plan needs per team position. The editor sends the full
 * set it is showing; positions left out keep whatever they already had.
 */
export const setPlanPositionNeedsSchema = z.object({
  needs: z
    .array(
      z.object({
        position_id: uuid,
        needed: z.number().int().min(0).max(99),
      }),
    )
    .max(500),
});

export const listPlansQuerySchema = paginationSchema.extend({
  status: planStatusSchema.optional(),
  service_type_id: uuid.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const calendarQuerySchema = z.object({
  from: z.string(),
  to: z.string(),
  service_type_id: uuid.optional(),
  team_id: uuid.optional(),
  /** Limit to plans the caller is scheduled on. */
  mine: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(false),
  include_rehearsals: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(true),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
/** What a client sends to create a plan (defaults still to be applied). */
export type CreatePlanRequest = z.input<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreatePlanItemInput = z.infer<typeof createPlanItemSchema>;
/** What a client sends to add an item; defaults are applied by the server. */
export type CreatePlanItemRequest = z.input<typeof createPlanItemSchema>;
export type UpdatePlanItemInput = z.infer<typeof updatePlanItemSchema>;
/** What a client sends to edit an item. */
export type UpdatePlanItemRequest = z.input<typeof updatePlanItemSchema>;
export type ReorderPlanItemsInput = z.infer<typeof reorderPlanItemsSchema>;
export type DeletePlanItemQuery = z.infer<typeof deletePlanItemQuerySchema>;
export type PlanScheduleQuery = z.infer<typeof planScheduleQuerySchema>;
export type SetPlanPositionNeedsInput = z.infer<typeof setPlanPositionNeedsSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type DuplicatePlanInput = z.infer<typeof duplicatePlanSchema>;
/** What a client sends; defaults are applied by the server. */
export type DuplicatePlanRequest = z.input<typeof duplicatePlanSchema>;
export type ImportPlanContentsInput = z.infer<typeof importPlanContentsSchema>;
export type ImportPlanContentsRequest = z.input<typeof importPlanContentsSchema>;

export type OrphanResolutionInput = z.infer<typeof orphanResolutionSchema>;
