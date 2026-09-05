import { z } from 'zod';
import { musicalKey, nonEmpty, paginationSchema, uuid } from './common.js';

export const planStatusSchema = z.enum(['draft', 'published', 'archived']);
export const planTimeKindSchema = z.enum(['service', 'rehearsal', 'other']);
export const planItemTypeSchema = z.enum(['song', 'header', 'item']);

export const planTimeSchema = z
  .object({
    kind: planTimeKindSchema.default('service'),
    name: z.string().trim().max(120).nullish(),
    starts_at: z.string(),
    ends_at: z.string(),
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
});

export const updatePlanSchema = createPlanSchema
  .partial()
  .omit({ copy_from_plan_id: true, copy_assignments: true });

export const createPlanItemSchema = z
  .object({
    item_type: planItemTypeSchema.default('item'),
    title: nonEmpty.max(200).optional(),
    song_id: uuid.nullish(),
    arrangement_id: uuid.nullish(),
    key_override: musicalKey.nullish(),
    length_seconds: z.number().int().min(0).max(36_000).default(0),
    description: z.string().trim().max(4000).nullish(),
    sort_order: z.number().int().min(0).optional(),
  })
  .refine((v) => v.item_type !== 'song' || Boolean(v.song_id), {
    message: 'A song item needs a song_id',
    path: ['song_id'],
  })
  .refine((v) => v.item_type === 'song' || Boolean(v.title), {
    message: 'Title is required',
    path: ['title'],
  });

export const updatePlanItemSchema = z.object({
  title: nonEmpty.max(200).optional(),
  song_id: uuid.nullish(),
  arrangement_id: uuid.nullish(),
  key_override: musicalKey.nullish(),
  length_seconds: z.number().int().min(0).max(36_000).optional(),
  description: z.string().trim().max(4000).nullish(),
});

/** Full ordering after a drag-and-drop, sent as the ids in their new order. */
export const reorderPlanItemsSchema = z.object({
  item_ids: z.array(uuid).min(1).max(500),
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
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type CreatePlanItemInput = z.infer<typeof createPlanItemSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
