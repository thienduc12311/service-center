import { z } from 'zod';
import { uuid } from './common.js';

/** F14 inputs: playback rights, media bundles, item media, stage layouts. */

const revision = z.number().int().min(0);

export const filePlaybackRightsSchema = z.enum(['download', 'stream_only']);

export const setFilePlaybackRightsSchema = z.object({
  expected_revision: revision,
  playback_rights: filePlaybackRightsSchema,
});
export type SetFilePlaybackRightsInput = z.infer<typeof setFilePlaybackRightsSchema>;

// ----------------------------------------------------------------- media --

const label = z.string().trim().min(1).max(60);
const labels = z.array(label).max(20, 'At most 20');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-24');

const mediaFields = {
  title: z.string().trim().min(1, 'Give the media a title').max(200),
  creator: z.string().trim().max(200).nullable().optional(),
  duration_seconds: z.number().int().min(0).max(86_400).nullable().optional(),
  themes: labels.optional(),
  tags: labels.optional(),
  notes: z.string().max(5000).nullable().optional(),
  archive_on: isoDate.nullable().optional(),
};

export const createMediaSchema = z.object(mediaFields);
export type CreateMediaInput = z.infer<typeof createMediaSchema>;

export const updateMediaSchema = z
  .object({
    expected_revision: revision,
    ...mediaFields,
    title: mediaFields.title.optional(),
    thumbnail_file_id: uuid.nullable().optional(),
  });
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const archiveMediaSchema = z.object({ expected_revision: revision, archived: z.boolean() });
export type ArchiveMediaInput = z.infer<typeof archiveMediaSchema>;

export const deleteMediaSchema = z.object({ expected_revision: revision });
export type DeleteMediaInput = z.infer<typeof deleteMediaSchema>;

export const listMediaQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** Pickers leave archived bundles out; the library can include them. */
  include_archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

/** Link (or clear, with null) a bundle on a regular order item. */
export const setPlanItemMediaSchema = z.object({
  media_id: uuid.nullable(),
  expected_revision: revision.optional(),
});
export type SetPlanItemMediaInput = z.infer<typeof setPlanItemMediaSchema>;

// --------------------------------------------------------- stage layouts --

export const stageBackgroundSchema = z.enum(['blank', 'stage', 'thrust', 'round']);

const unit = z.number().min(0).max(1);
const size = z.number().gt(0).max(1);

export const stageObjectSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['person', 'gear', 'label']),
    x: unit,
    y: unit,
    w: size,
    h: size,
    rotation: z.number().min(-360).max(360),
    label: z.string().max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1f6feb')
      .nullable(),
    person_id: uuid.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.kind === 'person') !== Boolean(value.person_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['person_id'],
        message: 'People carry a Person id; gear and labels do not',
      });
    }
  });

const stageObjects = z
  .array(stageObjectSchema)
  .max(200, 'A layout holds at most 200 objects')
  .refine((objects) => new Set(objects.map((object) => object.id)).size === objects.length, 'Object ids must be unique');

const templateObjects = stageObjects.refine(
  (objects) => objects.every((object) => object.kind !== 'person'),
  'Templates hold gear and labels; place people on a plan layout',
);

const layoutName = z.string().trim().min(1, 'Name the layout').max(120);

export const createStageTemplateSchema = z.object({
  name: layoutName,
  background: stageBackgroundSchema.default('stage'),
  objects: templateObjects.default([]),
});
export type CreateStageTemplateInput = z.infer<typeof createStageTemplateSchema>;

export const updateStageTemplateSchema = z.object({
  expected_revision: revision,
  name: layoutName.optional(),
  background: stageBackgroundSchema.optional(),
  objects: templateObjects.optional(),
  archived: z.boolean().optional(),
});
export type UpdateStageTemplateInput = z.infer<typeof updateStageTemplateSchema>;

export const createPlanStageLayoutSchema = z.object({
  name: layoutName,
  /** Start from a template's background and gear (copied, not linked live). */
  template_id: uuid.nullable().optional(),
  background: stageBackgroundSchema.optional(),
  objects: stageObjects.optional(),
});
export type CreatePlanStageLayoutInput = z.infer<typeof createPlanStageLayoutSchema>;

export const updatePlanStageLayoutSchema = z.object({
  expected_revision: revision,
  name: layoutName.optional(),
  background: stageBackgroundSchema.optional(),
  objects: stageObjects.optional(),
  /** Set when this save is a deliberate refresh against current staffing. */
  refreshed: z.boolean().optional(),
});
export type UpdatePlanStageLayoutInput = z.infer<typeof updatePlanStageLayoutSchema>;

export const deleteRevisionedSchema = z.object({ expected_revision: revision });
export type DeleteRevisionedInput = z.infer<typeof deleteRevisionedSchema>;

// ------------------------------------------------------------ rehearsal --

/** 2 GiB is the hard ceiling; a device may ask for less to fit its storage. */
export const OFFLINE_PACK_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export const offlinePackRequestSchema = z.object({
  max_bytes: z.number().int().min(1).max(OFFLINE_PACK_MAX_BYTES).optional(),
});
export type OfflinePackRequestInput = z.infer<typeof offlinePackRequestSchema>;

/** Request bodies as a client sends them (defaults applied by the server). */
export type CreateStageTemplateRequest = z.input<typeof createStageTemplateSchema>;
export type ListMediaRequest = { q?: string; include_archived?: boolean };
