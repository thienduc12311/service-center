import { z } from 'zod';
import { idempotencyKey, uuid } from './common.js';
import { FILE_MAX_BYTES, FILE_MIME_TYPES, FILE_DOCUMENT_MAX_CHARS } from '../lib/files.js';

export const fileOwnerKindSchema = z.enum(['plan', 'plan_item', 'song', 'arrangement', 'service_type']);
export const fileAudienceSchema = z.enum(['organization', 'scheduled', 'teams', 'positions', 'leaders']);
export const fileCategorySchema = z.enum(['chart', 'lyrics', 'audio', 'video', 'image', 'document', 'other']);

const revision = z.number().int().min(0);
const title = z.string().trim().min(1, 'Give the file a title').max(200);
const ids = (max: number) => z.array(uuid).max(max).default([]);

/** Audience plus its teams/positions; the database revalidates every id. */
const audienceFields = {
  category: fileCategorySchema.default('other'),
  audience: fileAudienceSchema.default('organization'),
  team_ids: ids(50),
  position_ids: ids(100),
};

const audienceTargetsRequired = <T extends { audience: string; team_ids: string[]; position_ids: string[] }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.audience === 'teams' && value.team_ids.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['team_ids'], message: 'Choose at least one team' });
  }
  if (value.audience === 'positions' && value.position_ids.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['position_ids'], message: 'Choose at least one position' });
  }
};

export const fileOwnerRefSchema = z.object({ kind: fileOwnerKindSchema, id: uuid });

export const listFilesQuerySchema = z.object({ owner_kind: fileOwnerKindSchema, owner_id: uuid });

/**
 * A new upload (owner) or a replacement (`file_id` + `expected_revision`).
 * Type and size are checked here and again by the database and Storage.
 */
export const createFileUploadIntentSchema = z
  .object({
    owner: fileOwnerRefSchema.optional(),
    file_id: uuid.optional(),
    expected_revision: revision.optional(),
    filename: z.string().trim().min(1).max(200),
    mime_type: z.enum(FILE_MIME_TYPES, { errorMap: () => ({ message: 'That file type is not supported' }) }),
    size_bytes: z
      .number()
      .int()
      .min(1, 'The file is empty')
      .max(FILE_MAX_BYTES, 'Files are limited to 25 MB'),
    title: z.string().trim().max(200).optional(),
    idempotency_key: idempotencyKey,
    ...audienceFields,
  })
  .superRefine((value, ctx) => {
    if (!value.owner && !value.file_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['owner'], message: 'Choose where the file belongs' });
    }
    if (value.file_id && value.expected_revision === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expected_revision'], message: 'expected_revision is required' });
    }
    if (!value.file_id) audienceTargetsRequired(value, ctx);
  });

export const finalizeFileSchema = z.object({ version_id: uuid });
export const abandonFileUploadSchema = z.object({ version_id: uuid });

/** http(s) only, no credentials; the server stores it and never fetches it. */
export const externalFileUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url('Enter a full web address')
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an http(s) address without a user name or password');

export const createFileLinkSchema = z
  .object({ owner: fileOwnerRefSchema, title, url: externalFileUrlSchema, idempotency_key: idempotencyKey, ...audienceFields })
  .superRefine(audienceTargetsRequired);

export const updateFileLinkUrlSchema = z.object({ title, url: externalFileUrlSchema, expected_revision: revision });

export const createFileDocumentSchema = z
  .object({
    owner: fileOwnerRefSchema,
    title,
    body: z.string().max(FILE_DOCUMENT_MAX_CHARS, 'Documents are limited to 100,000 characters'),
    idempotency_key: idempotencyKey,
    ...audienceFields,
  })
  .superRefine(audienceTargetsRequired);

/** Saves the text as a new version. */
export const saveFileDocumentVersionSchema = z.object({
  title,
  body: z.string().max(FILE_DOCUMENT_MAX_CHARS, 'Documents are limited to 100,000 characters'),
  expected_revision: revision,
});

/** Title/category/audience and an optional move within the same plan or song. */
export const updateFileSchema = z
  .object({
    title,
    expected_revision: revision,
    move_to: fileOwnerRefSchema.optional(),
    ...audienceFields,
  })
  .superRefine(audienceTargetsRequired);

export const archiveFileSchema = z.object({ archived: z.boolean(), expected_revision: revision });
export const deleteFileSchema = z.object({ expected_revision: revision });

export const fileDownloadSchema = z.object({
  version_id: uuid.optional(),
  /** `inline` previews in the browser; `attachment` saves the file. */
  disposition: z.enum(['inline', 'attachment']).default('inline'),
});

export const linkFileToPlanSchema = z.object({
  file_id: uuid,
  plan_item_id: uuid.nullable().default(null),
  /** Pin the current version (historical preparation) or follow future replacements. */
  pin: z.boolean().default(true),
});

export const setFileLinkPinSchema = z.object({
  /** `current`: pin the file's current version; `version`: pin `version_id`; `follow`: always current. */
  mode: z.enum(['current', 'version', 'follow']),
  version_id: uuid.optional(),
});

export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;
export type CreateFileUploadIntentInput = z.infer<typeof createFileUploadIntentSchema>;
export type CreateFileUploadIntentRequest = z.input<typeof createFileUploadIntentSchema>;
export type FinalizeFileInput = z.infer<typeof finalizeFileSchema>;
export type AbandonFileUploadInput = z.infer<typeof abandonFileUploadSchema>;
export type CreateFileLinkInput = z.infer<typeof createFileLinkSchema>;
export type CreateFileLinkRequest = z.input<typeof createFileLinkSchema>;
export type UpdateFileLinkUrlInput = z.infer<typeof updateFileLinkUrlSchema>;
export type CreateFileDocumentInput = z.infer<typeof createFileDocumentSchema>;
export type CreateFileDocumentRequest = z.input<typeof createFileDocumentSchema>;
export type SaveFileDocumentVersionInput = z.infer<typeof saveFileDocumentVersionSchema>;
export type UpdateFileInput = z.infer<typeof updateFileSchema>;
export type UpdateFileRequest = z.input<typeof updateFileSchema>;
export type ArchiveFileInput = z.infer<typeof archiveFileSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileSchema>;
export type FileDownloadInput = z.infer<typeof fileDownloadSchema>;
export type FileDownloadRequest = z.input<typeof fileDownloadSchema>;
export type LinkFileToPlanInput = z.infer<typeof linkFileToPlanSchema>;
export type LinkFileToPlanRequest = z.input<typeof linkFileToPlanSchema>;
export type SetFileLinkPinInput = z.infer<typeof setFileLinkPinSchema>;
