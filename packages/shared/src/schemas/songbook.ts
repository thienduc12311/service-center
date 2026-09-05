import { z } from 'zod';
import { nonEmpty, uuid } from './common.js';

export const createSongbookSchema = z
  .object({
    title: nonEmpty.max(200),
    description: z.string().trim().max(2000).nullish(),
    source_type: z.enum(['manual', 'document']),
    source_storage_path: z.string().trim().max(1000).nullish(),
    source_filename: z.string().trim().max(255).nullish(),
    songs: z
      .array(z.object({ song_id: uuid, arrangement_id: uuid.nullish() }))
      .max(500)
      .default([]),
  })
  .superRefine((value, context) => {
    if (value.source_type === 'manual' && value.songs.length === 0) {
      context.addIssue({ code: 'custom', path: ['songs'], message: 'Choose at least one song' });
    }
    if (value.source_type === 'document' && !value.source_storage_path) {
      context.addIssue({ code: 'custom', path: ['source_storage_path'], message: 'Attach a document' });
    }
  });

export type CreateSongbookInput = z.infer<typeof createSongbookSchema>;
