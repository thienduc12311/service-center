import { z } from 'zod';
import { idempotencyKey, nonEmpty, uuid } from './common.js';

const tag = z.string().trim().min(1).max(60).transform((value) => value.toLowerCase());

export const rosterBulkActionSchema = z.enum(['add_tag', 'remove_tag', 'add_to_team', 'remove_from_team']);

const bulkBase = z.object({
  person_ids: z.array(uuid).min(1).max(500),
  action: rosterBulkActionSchema,
  tag: tag.nullish(),
  team_id: uuid.nullish(),
  position_id: uuid.nullish(),
});

const needsTarget = (value: z.infer<typeof bulkBase>): boolean =>
  value.action === 'add_tag' || value.action === 'remove_tag' ? Boolean(value.tag) : Boolean(value.team_id);
const needsTargetIssue = { message: 'Tag changes need a tag; team changes need a team', path: ['action'] };

export const previewRosterBulkSchema = bulkBase.refine(needsTarget, needsTargetIssue);

export const applyRosterBulkSchema = bulkBase
  .extend({
    /** The number of `change` rows the preview showed. */
    expected_changes: z.number().int().min(0).max(500),
    idempotency_key: idempotencyKey,
  })
  .refine(needsTarget, needsTargetIssue);

export const createTagGroupSchema = z.object({
  name: nonEmpty.max(60),
  sort_order: z.number().int().min(0).max(1000).default(0),
});
export const updateTagGroupSchema = createTagGroupSchema.partial();

export const setTagGroupSchema = z.object({
  tag,
  group_id: uuid.nullable(),
});

export const listPeopleQuerySchema = z.object({
  include_archived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

export const rosterAuditQuerySchema = z.object({
  person_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const globalSearchKindSchema = z.enum(['person', 'team', 'position', 'plan', 'song', 'media']);

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type PreviewRosterBulkInput = z.infer<typeof previewRosterBulkSchema>;
export type PreviewRosterBulkRequest = z.input<typeof previewRosterBulkSchema>;
export type ApplyRosterBulkInput = z.infer<typeof applyRosterBulkSchema>;
export type ApplyRosterBulkRequest = z.input<typeof applyRosterBulkSchema>;
export type CreateTagGroupInput = z.infer<typeof createTagGroupSchema>;
export type CreateTagGroupRequest = z.input<typeof createTagGroupSchema>;
export type UpdateTagGroupInput = z.infer<typeof updateTagGroupSchema>;
export type SetTagGroupInput = z.infer<typeof setTagGroupSchema>;
export type ListPeopleQuery = z.infer<typeof listPeopleQuerySchema>;
export type RosterAuditQuery = z.infer<typeof rosterAuditQuerySchema>;
export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;

// ------------------------------------------------- guest staffing (Pass B)

/** A minimal no-login Person a scheduler adds while staffing. */
export const createGuestSchema = z.object({
  first_name: nonEmpty.max(80),
  last_name: z.string().trim().max(80).nullish(),
  /** Contact only: never used to merge identities, and no invitation is sent. */
  email: z.string().trim().toLowerCase().email().max(254).nullish(),
});

/** A position that exists on one plan only, owned by a team. */
export const createPlanPositionSchema = z.object({
  team_id: uuid,
  name: nonEmpty.max(80),
  needed: z.number().int().min(0).max(50).default(1),
});

export const deliveryReadinessSchema = z.object({
  person_ids: z.array(uuid).min(1).max(200),
});

export const resolveReconciliationSchema = z.object({
  action: z.enum(['keep_separate', 'merge']),
});

export type CreateGuestInput = z.infer<typeof createGuestSchema>;
export type CreatePlanPositionInput = z.infer<typeof createPlanPositionSchema>;
export type CreatePlanPositionRequest = z.input<typeof createPlanPositionSchema>;
export type DeliveryReadinessInput = z.infer<typeof deliveryReadinessSchema>;
export type ResolveReconciliationInput = z.infer<typeof resolveReconciliationSchema>;
