import { z } from 'zod';
import { idempotencyKey, nonEmpty, uuid } from './common.js';

export const accessCapabilitySchema = z.enum([
  'plans.edit',
  'scheduling.manage',
  'teams.manage',
  'people.view_private',
  'people.manage',
  'songs.manage',
  'media.manage',
]);
export const accessScopeTypeSchema = z.enum(['organization', 'folder', 'service_type', 'team']);
export const accessModeSchema = z.enum(['legacy', 'scoped']);
export const assignmentVisibilitySchema = z.enum(['prepared', 'released']);

/** PUT …/access: the complete set of grants at that scope. */
export const replaceScopeGrantsSchema = z.object({
  grants: z
    .array(z.object({ user_id: uuid, capability: accessCapabilitySchema }))
    .max(500),
});

export const updateMemberAccessSchema = z.object({ access_mode: accessModeSchema });

export const explainCapabilityQuerySchema = z.object({
  user_id: uuid,
  capability: accessCapabilitySchema,
  service_type_id: uuid.optional(),
  team_id: uuid.optional(),
});

/** Release exactly the reviewed prepared requests. */
export const releaseAssignmentsSchema = z.object({
  assignment_ids: z.array(uuid).min(1).max(500),
  expected_revisions: z.array(z.object({
    assignment_id: uuid,
    request_revision: z.number().int().min(0),
  })).max(500).default([]),
  notify: z.boolean().default(true),
  idempotency_key: idempotencyKey.optional(),
});

export const releaseAssignmentsPreviewSchema = z.object({
  assignment_ids: z.array(uuid).min(1).max(500),
});

export const setResponseOwnerSchema = z.object({
  assignment_ids: z.array(uuid).min(1).max(500),
  response_owner_id: uuid,
});

// --------------------------------------------------------------- folders --
export const createFolderSchema = z.object({
  name: nonEmpty.max(120),
  parent_id: uuid.nullish(),
  sort_order: z.number().int().min(0).default(0),
});

export const updateFolderSchema = z.object({
  name: nonEmpty.max(120).optional(),
  sort_order: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
});

export const moveFolderSchema = z.object({
  parent_id: uuid.nullable(),
  /** The folder revision the preview was made against. */
  expected_revision: z.number().int().min(0).nullish(),
  /** Required when the preview showed access changes. */
  acknowledge_changes: z.boolean().default(false),
});

export const folderMovePreviewQuerySchema = z.object({ parent_id: uuid.optional() });

export const moveServiceTypeSchema = z.object({
  folder_id: uuid.nullable(),
  acknowledge_changes: z.boolean().default(false),
});

export const serviceTypeMovePreviewQuerySchema = z.object({ folder_id: uuid.optional() });

export const setLandingFolderSchema = z.object({ folder_id: uuid.nullable() });

export const archiveServiceTypeSchema = z.object({ archived: z.boolean() });

export const copyServiceTypeSchema = z.object({
  name: nonEmpty.max(120),
  /** Copy which teams serve it (never people or grants). */
  include_teams: z.boolean().default(true),
});

export const serviceTypeTeamsSchema = z.object({ team_ids: z.array(uuid).max(200) });

// ---------------------------------------------------------- team policies --
const tag = z.string().trim().min(1).max(60);

export const teamTagRulesSchema = z.object({ tags: z.array(tag).max(50) });
export const personTagsSchema = z.object({ tags: z.array(tag).max(50) });
export const relatedTeamsSchema = z.object({ team_ids: z.array(uuid).max(100) });
export const rosterVisibilitySchema = z.object({ assignment_visibility: z.enum(['organization', 'teams']) });

export const eligibilityRecordSchema = z
  .object({
    user_id: uuid,
    kind: z.string().trim().min(1).max(60),
    status: z.enum(['clear', 'not_clear', 'pending']),
    provider: z.string().trim().min(1).max(80),
    provider_reference: z.string().trim().max(200).nullish(),
    verified_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
  })
  .refine((value) => new Date(value.expires_at) > new Date(value.verified_at), {
    message: 'Expiry must be after verification',
    path: ['expires_at'],
  });

export type ReplaceScopeGrantsInput = z.infer<typeof replaceScopeGrantsSchema>;
export type UpdateMemberAccessInput = z.infer<typeof updateMemberAccessSchema>;
export type ExplainCapabilityQuery = z.infer<typeof explainCapabilityQuerySchema>;
export type ReleaseAssignmentsInput = z.infer<typeof releaseAssignmentsSchema>;
export type ReleaseAssignmentsRequest = z.input<typeof releaseAssignmentsSchema>;
export type ReleaseAssignmentsPreviewInput = z.infer<typeof releaseAssignmentsPreviewSchema>;
export type SetResponseOwnerInput = z.infer<typeof setResponseOwnerSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type CreateFolderRequest = z.input<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
export type MoveFolderInput = z.infer<typeof moveFolderSchema>;
export type MoveFolderRequest = z.input<typeof moveFolderSchema>;
export type MoveServiceTypeInput = z.infer<typeof moveServiceTypeSchema>;
export type MoveServiceTypeRequest = z.input<typeof moveServiceTypeSchema>;
export type SetLandingFolderInput = z.infer<typeof setLandingFolderSchema>;
export type ArchiveServiceTypeInput = z.infer<typeof archiveServiceTypeSchema>;
export type CopyServiceTypeInput = z.infer<typeof copyServiceTypeSchema>;
export type CopyServiceTypeRequest = z.input<typeof copyServiceTypeSchema>;
export type ServiceTypeTeamsInput = z.infer<typeof serviceTypeTeamsSchema>;
export type TeamTagRulesInput = z.infer<typeof teamTagRulesSchema>;
export type PersonTagsInput = z.infer<typeof personTagsSchema>;
export type RelatedTeamsInput = z.infer<typeof relatedTeamsSchema>;
export type RosterVisibilityInput = z.infer<typeof rosterVisibilitySchema>;
export type EligibilityRecordInput = z.infer<typeof eligibilityRecordSchema>;
