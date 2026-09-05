import { z } from 'zod';
import { musicalKey, nonEmpty, uuid } from './common.js';

/**
 * Phase 2 — chord sheet import.
 * The client uploads to the `chord-sheets` bucket, then registers the object
 * here; the server runs OCR and fills in the parsed result.
 */
export const createImportSchema = z.object({
  storage_path: nonEmpty.max(500),
  original_filename: z.string().trim().max(255).nullish(),
});

export const importStatusSchema = z.enum(['pending', 'processing', 'succeeded', 'failed']);

/** Operator corrections applied before the import becomes a song. */
export const acceptImportSchema = z.object({
  title: nonEmpty.max(200),
  author: z.string().trim().max(200).nullish(),
  song_key: musicalKey.nullish(),
  chordpro: nonEmpty.max(100_000),
  song_id: uuid.optional(), // attach as a new arrangement of an existing song
  arrangement_name: nonEmpty.max(120).default('Imported Arrangement'),
});

export type CreateImportInput = z.infer<typeof createImportSchema>;
export type AcceptImportInput = z.infer<typeof acceptImportSchema>;
