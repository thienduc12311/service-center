import { z } from 'zod';
import { musicalKey, nonEmpty, paginationSchema } from './common.js';

export const createSongSchema = z.object({
  title: nonEmpty.max(200),
  author: z.string().trim().max(200).nullish(),
  ccli_number: z.string().trim().max(40).nullish(),
  copyright: z.string().trim().max(300).nullish(),
  default_key: musicalKey.nullish(),
  default_bpm: z.number().int().min(20).max(300).nullish(),
  meter: z.string().trim().max(20).nullish(),
  themes: z.array(nonEmpty.max(40)).max(20).default([]),
  notes: z.string().trim().max(4000).nullish(),
});

export const updateSongSchema = createSongSchema.partial();

export const createArrangementSchema = z.object({
  name: nonEmpty.max(120).default('Default Arrangement'),
  song_key: musicalKey.nullish(),
  bpm: z.number().int().min(20).max(300).nullish(),
  meter: z.string().trim().max(20).nullish(),
  length_seconds: z.number().int().min(0).max(36_000).nullish(),
  sequence: z.array(nonEmpty.max(20)).max(60).default([]),
  chord_chart: z.string().max(100_000).nullish(),
  chord_chart_format: z.enum(['chordpro', 'text']).default('chordpro'),
  is_default: z.boolean().default(false),
});

export const updateArrangementSchema = createArrangementSchema.partial();

export const listSongsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  theme: z.string().trim().max(40).optional(),
  sort: z.enum(['title', 'recent', 'last_scheduled']).default('title'),
});

export const transposeQuerySchema = z.object({
  to: musicalKey.optional(),
  semitones: z.coerce.number().int().min(-11).max(11).optional(),
  prefer: z.enum(['sharps', 'flats']).default('sharps'),
});

export type CreateSongInput = z.infer<typeof createSongSchema>;
export type CreateArrangementInput = z.infer<typeof createArrangementSchema>;
export type ListSongsQuery = z.infer<typeof listSongsQuerySchema>;
