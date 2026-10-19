import { z } from 'zod';
import { musicalKey, uuid } from './common.js';

const ids = z.array(uuid).max(100).refine((v) => new Set(v).size === v.length, 'Duplicate selection');
export const labeledKeyInputSchema = z.object({
  id: uuid, expected_revision: z.number().int().positive().nullable(),
  label: z.string().trim().min(1).max(80), song_key: musicalKey.regex(/^[A-G](#|b)?m?$/, 'Choose a musical key'),
  capo: z.number().int().min(0).max(11).nullable(),
  vocal_label: z.string().trim().max(80).nullable(), file_ids: ids,
}).strict();
export const labeledKeySchema = labeledKeyInputSchema.omit({ expected_revision: true }).extend({
  arrangement_id: uuid, revision: z.number().int().positive(), created_at: z.string(),
});
export const arrangementMaterialsSchema = z.object({
  keys: z.array(labeledKeySchema),
  files: z.array(z.object({ id: uuid, title: z.string(), revision: z.number().int().positive(),
    key_ids: z.array(uuid), reused: z.boolean() })),
});
export const duplicateArrangementSchema = z.object({
  name: z.string().trim().min(1).max(120), expected_revision: z.number().int().positive(),
  metadata: z.boolean(), sections: z.boolean(), chart: z.boolean(), key_ids: ids, file_ids: ids,
}).strict();
export const duplicatePreviewSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), source_id: uuid,
  selection: duplicateArrangementSchema,
  files: arrangementMaterialsSchema.shape.files, keys: z.array(labeledKeySchema),
});
export const duplicateCommitSchema = duplicateArrangementSchema.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), idempotency_key: uuid,
}).strict();
export const duplicateResultSchema = z.object({ arrangement_id: uuid, operation_id: uuid });
export const songMergeInputSchema = z.object({ winner_id: uuid, loser_id: uuid }).strict()
  .refine((v) => v.winner_id !== v.loser_id, 'Choose two different songs');
export const songMergePreviewSchema = z.object({
  winner_id: uuid, loser_id: uuid, winner_title: z.string(), loser_title: z.string(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  arrangements: z.number().int(), files: z.number().int(), keys: z.number().int(),
  plan_items: z.number().int(), songbook_items: z.number().int(), template_revisions: z.number().int(),
  blockers: z.array(z.string()), policy: z.string(),
  metadata: z.array(z.object({ field: z.string(), kept: z.unknown(), losing: z.unknown() })),
  arrangement_details: z.array(z.object({ id: uuid, song_id: uuid, name: z.string(), is_default: z.boolean(), archived_at: z.string().nullable(), song_key: z.string().nullable() })),
  file_details: z.array(z.object({ id: uuid, title: z.string(), arrangement_id: uuid.nullable(), audience: z.string(), playback_rights: z.string() })),
  key_details: z.array(z.object({ id: uuid, arrangement_id: uuid, label: z.string(), song_key: z.string(), capo: z.number().nullable(), vocal_label: z.string().nullable() })),
  plan_references: z.array(z.object({ id: uuid, parent_id: uuid, title: z.string(), song_id: uuid, arrangement_id: uuid.nullable(), key_override: z.string().nullable() })),
  book_references: z.array(z.object({ id: uuid, parent_id: uuid, song_id: uuid, arrangement_id: uuid.nullable() })),
  template_details: z.array(z.object({ id: uuid, template_id: uuid, revision: z.number().int() })),
  live_history: z.number().int().nonnegative(),
});
export const songMergeCommitSchema = z.object({
  winner_id: uuid, loser_id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), idempotency_key: uuid,
}).strict().refine((v) => v.winner_id !== v.loser_id, 'Choose two different songs');
export const songMergeResultSchema = z.object({ winner_id: uuid, loser_id: uuid, operation_id: uuid });
export const duplicateSongsSchema = z.array(z.object({ id: uuid, title: z.string(), reason: z.enum(['title', 'ccli']) })).max(50);
export type LabeledKeyInput = z.infer<typeof labeledKeyInputSchema>;
export type LabeledKey = z.infer<typeof labeledKeySchema>;
export type ArrangementMaterials = z.infer<typeof arrangementMaterialsSchema>;
export type DuplicateArrangementInput = z.infer<typeof duplicateArrangementSchema>;
export type DuplicateArrangementCommit = z.infer<typeof duplicateCommitSchema>;
export type DuplicateArrangementPreview = z.infer<typeof duplicatePreviewSchema>;
export type SongMergeInput = z.infer<typeof songMergeInputSchema>;
export type SongMergeCommit = z.infer<typeof songMergeCommitSchema>;
export type SongMergePreview = z.infer<typeof songMergePreviewSchema>;
