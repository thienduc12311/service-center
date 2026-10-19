import { z } from 'zod';
import { uuid, idempotencyKey } from './common.js';
import { createPersonSchema } from './people.js';
import { songFieldsSchema } from './song.js';

/** Portable UTF-8 sizing; shared is also bundled by Hermes. */
export function importUtf8Length(value: string): number {
  let size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}
function wellFormedImportText(value: string): boolean {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return !value.includes('\0');
}
export const IMPORT_MAX_BYTES = 262_144;
export const IMPORT_MAX_ROWS = 100;
export const importKindSchema = z.enum(['people', 'songs']);
export const importPersonSchema = createPersonSchema.pick({
  first_name: true, last_name: true, email: true, phone: true, campus: true, person_type: true,
}).extend({ email: z.string().trim().toLowerCase().max(254).email().nullish() }).strict();
export const importPersonUpdateSchema = importPersonSchema.partial().extend({ person_type: z.enum(['adult', 'child']).optional() });
export const importSongSchema = songFieldsSchema.strict();
export const importSongUpdateSchema = songFieldsSchema.partial().strict();
export const importFieldNames = {
  people: ['id', 'first_name', 'last_name', 'email', 'phone', 'campus', 'person_type'],
  songs: ['id', ...Object.keys(songFieldsSchema.shape)],
} as const;
export const importFileSchema = z.object({
  filename: z.string().trim().min(1).max(200).regex(/\.csv$/i, 'Choose a CSV file'),
  content_type: z.enum(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']),
  content: z.string().min(1).refine((s) => importUtf8Length(s) <= IMPORT_MAX_BYTES, 'CSV exceeds 256 KiB')
    .refine(wellFormedImportText, 'Invalid CSV text'),
}).strict();
export const importResolutionSchema = z.object({
  row: z.number().int().min(2).max(101),
  action: z.enum(['create', 'update', 'skip']),
  target_id: uuid.optional(),
}).strict().refine((r) => r.action === 'update' ? !!r.target_id : !r.target_id, 'Only updates have a target ID');
export const importPreviewRequestSchema = importFileSchema.extend({
  kind: importKindSchema,
  mapping: z.record(z.string().min(1).max(100), z.string().min(1).max(200)),
  resolutions: z.array(importResolutionSchema).max(100).default([]),
}).strict().superRefine((v, ctx) => {
  const fields: readonly string[] = importFieldNames[v.kind];
  if (Object.keys(v.mapping).some((k) => !fields.includes(k))) ctx.addIssue({ code: 'custom', message: 'Unsupported destination field', path: ['mapping'] });
  if (new Set(Object.values(v.mapping)).size !== Object.values(v.mapping).length) ctx.addIssue({ code: 'custom', message: 'Map each source column once', path: ['mapping'] });
  if (new Set(v.resolutions.map((r) => r.row)).size !== v.resolutions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate row resolution', path: ['resolutions'] });
});
export const importSaveRequestSchema = z.object({
  source: importPreviewRequestSchema,
  preview_hash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotency_key: idempotencyKey,
}).strict();
export const importCommitRequestSchema = z.object({ expected_revision: z.number().int().positive() }).strict();
export const importCandidateSchema = z.object({
  id: uuid, label: z.string(), version: z.string(), archived: z.boolean(), data: z.record(z.unknown()),
});
export const importContextRowSchema = z.object({ row: z.number().int(), candidates: z.array(importCandidateSchema), candidate_count: z.number().int() });
export const importPreviewRowSchema = z.object({
  row: z.number().int(), action: z.enum(['create', 'update', 'skip', 'unresolved', 'error']),
  target_id: uuid.nullable(), expected_version: z.string().nullable(),
  data: z.record(z.unknown()), before: z.record(z.unknown()).nullable(),
  errors: z.array(z.string()), candidates: z.array(importCandidateSchema), candidate_count: z.number().int(),
});
export const importPreviewSchema = z.object({
  kind: importKindSchema, source_hash: z.string(), preview_hash: z.string(),
  rows: z.array(importPreviewRowSchema), can_commit: z.boolean(),
});
export const importJobSchema = z.object({
  id: uuid, organization_id: uuid, created_by: uuid, kind: importKindSchema,
  filename: z.string(), source_hash: z.string(), preview_hash: z.string(),
  idempotency_key: z.string(), revision: z.number().int(), status: z.enum(['reviewed', 'committed']),
  created_at: z.string(), committed_at: z.string().nullable(),
});
export const importJobRowSchema = z.object({
  job_id: uuid, row_number: z.number().int(), action: z.enum(['create', 'update', 'skip']),
  target_id: uuid.nullable(), expected_version: z.string().nullable(), data: z.record(z.unknown()),
  before_data: z.record(z.unknown()).nullable(), after_data: z.record(z.unknown()).nullable(),
  result_id: uuid.nullable(),
});
export const importJobDetailSchema = z.object({ job: importJobSchema, rows: z.array(importJobRowSchema), source: importPreviewRequestSchema });
export type ImportKind = z.infer<typeof importKindSchema>;
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;
export type ImportSaveRequest = z.infer<typeof importSaveRequestSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportPreviewRow = z.infer<typeof importPreviewRowSchema>;
export type ImportCandidate = z.infer<typeof importCandidateSchema>;
export type ImportJob = z.infer<typeof importJobSchema>;
export type ImportJobRow = z.infer<typeof importJobRowSchema>;
export type ImportJobDetail = z.infer<typeof importJobDetailSchema>;
export type ImportCommitRequest = z.infer<typeof importCommitRequestSchema>;
export type ImportContextRow = z.infer<typeof importContextRowSchema>;
