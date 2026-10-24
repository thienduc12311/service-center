import { z } from 'zod';
import { musicalKey, nonEmpty, paginationSchema, uuid } from './common.js';

/** One entry in any of the song's tag vocabularies (themes, types). */
export const songTag = nonEmpty.max(40);

/** Column layout of the printed chart; mirrored by a database check constraint. */
export const chartColumnsSchema = z.union([z.literal(1), z.literal(2)]);

/** A CSS hex colour, the only form the chart template can print directly. */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour such as #1d4ed8');

export const createArrangementSchema = z.object({
  name: nonEmpty.max(120).default('Default Arrangement'),
  song_key: musicalKey.nullish(),
  /** Fret the capo sits on. Null (or omitted) means the arrangement is played open. */
  capo: z.number().int().min(0).max(11).nullish(),
  bpm: z.number().int().min(20).max(300).nullish(),
  meter: z.string().trim().max(20).nullish(),
  length_seconds: z.number().int().min(0).max(36_000).nullish(),
  sequence: z.array(nonEmpty.max(20)).max(60).default([]),
  chord_chart: z.string().max(100_000).nullish(),
  chord_chart_format: z.enum(['chordpro', 'text']).default('chordpro'),
  /**
   * How the chart is laid out when it is rendered to HTML or printed. Left out
   * entirely, the database default (one column) stands; null on the other three
   * means "use the chart template's default".
   */
  chart_columns: chartColumnsSchema.optional(),
  chart_font: z.string().trim().max(120).nullish(),
  chart_font_size: z.number().int().min(6).max(48).nullish(),
  chart_chord_color: hexColor.nullish(),
  is_default: z.boolean().default(false),
});

/**
 * The revision the editor opened with. Optional so older callers keep their
 * contract; when sent, a save over a newer revision is refused (409
 * `song_revision_stale` / `arrangement_revision_stale`) instead of silently
 * overwriting someone else's edit.
 */
export const expectedLibraryRevision = z.number().int().positive().optional();

export const updateArrangementSchema = createArrangementSchema.partial().extend({
  expected_revision: expectedLibraryRevision,
});

/** The fields that live on the song itself, shared by create and update. */
export const songFieldsSchema = z.object({
  title: nonEmpty.max(200),
  author: z.string().trim().max(200).nullish(),
  ccli_number: z.string().trim().max(40).nullish(),
  copyright: z.string().trim().max(300).nullish(),
  administration: z.string().trim().max(300).nullish(),
  default_key: musicalKey.nullish(),
  default_bpm: z.number().int().min(20).max(300).nullish(),
  meter: z.string().trim().max(20).nullish(),
  themes: z.array(songTag).max(20).default([]),
  song_types: z.array(songTag).max(20).default([]),
  style: z.string().trim().max(40).nullish(),
  speed: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(4000).nullish(),
});

/**
 * The Add Song form submits the song and its first arrangement together, so
 * the name, key, capo and pasted chart all land in one request.
 */
export const createSongSchema = songFieldsSchema.extend({
  arrangement: createArrangementSchema.partial().optional(),
});

export const updateSongSchema = songFieldsSchema.partial().extend({
  expected_revision: expectedLibraryRevision,
});

export const listSongsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  theme: z.string().trim().max(40).optional(),
  sort: z.enum(['title', 'recent']).default('title'),
  archive: z.enum(['active', 'archived', 'all']).default('active'),
  key: musicalKey.optional(),
  bpm_min: z.coerce.number().int().min(20).max(300).optional(),
  bpm_max: z.coerce.number().int().min(20).max(300).optional(),
  song_type: songTag.optional(),
  style: z.string().trim().max(40).optional(),
  speed: z.string().trim().max(40).optional(),
  author: z.string().trim().max(200).optional(),
  scheduled_from: z.string().datetime({ offset: true }).optional(),
  scheduled_to: z.string().datetime({ offset: true }).optional(),
}).refine((v) => v.bpm_min === undefined || v.bpm_max === undefined || v.bpm_min <= v.bpm_max,
  { message: 'Minimum BPM exceeds maximum', path: ['bpm_max'] })
  .refine((v) => !v.scheduled_from || !v.scheduled_to || Date.parse(v.scheduled_from) < Date.parse(v.scheduled_to),
    { message: 'Scheduled end must follow start', path: ['scheduled_to'] });

/**
 * How far back the Schedule panel looks. Counted in plans rather than days so
 * "the last 3 times we played it" reads the same for a weekly song and one
 * that only comes out at Christmas.
 */
export const songScheduleQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(3),
  /** Narrows the history to the arrangement that was actually scheduled. */
  arrangement_id: uuid.optional(),
});

export const chartNotationSchema = z.enum(['chords', 'numbers', 'numerals', 'lyrics']);

export const chartQuerySchema = z.object({
  to: musicalKey.optional(),
  semitones: z.coerce.number().int().min(-11).max(11).optional(),
  notation: chartNotationSchema.default('chords'),
});

/** A bounded, explicit replacement of metadata; absent fields stay unchanged. */
export const songBulkPatchSchema = songFieldsSchema.omit({ title: true }).partial().strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Choose metadata to change');
export const songBulkPreviewSchema = z.object({
  rows: z.array(z.object({ id: uuid, expected_revision: z.number().int().positive() }).strict()).min(1).max(100)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Duplicate song'),
  patch: songBulkPatchSchema,
}).strict();
export const songBulkCommitSchema = z.object({ preview_id: uuid }).strict();
export const songArchiveSchema = z.object({
  expected_revision: z.number().int().positive(), archived: z.boolean(),
}).strict();
export type SongBulkPatch = z.infer<typeof songBulkPatchSchema>;
export type SongBulkPreviewInput = z.infer<typeof songBulkPreviewSchema>;
export type SongBulkCommitInput = z.infer<typeof songBulkCommitSchema>;
export type SongArchiveInput = z.infer<typeof songArchiveSchema>;

export type CreateSongInput = z.infer<typeof createSongSchema>;
export type UpdateSongInput = z.infer<typeof updateSongSchema>;
export type SongFields = z.infer<typeof songFieldsSchema>;
export type CreateArrangementInput = z.infer<typeof createArrangementSchema>;
export type UpdateArrangementInput = z.infer<typeof updateArrangementSchema>;
export type ListSongsQuery = z.infer<typeof listSongsQuerySchema>;
export type SongScheduleQuery = z.infer<typeof songScheduleQuerySchema>;
export type ChartQuery = z.infer<typeof chartQuerySchema>;

/** Runtime validation for curation RPC results, including snapshots in audit rows. */
export const curatedSongRowSchema = songFieldsSchema.extend({
  merged_into_song_id: uuid.nullish(), merged_default_arrangement_id: uuid.nullish(),
  id: uuid, organization_id: uuid, created_by: uuid.nullable(),
  created_at: z.string(), updated_at: z.string(),
  archived_at: z.string().nullable(), revision: z.number().int().positive(),
});
export const curatedArrangementRowSchema = createArrangementSchema.extend({
  id: uuid, song_id: uuid, created_at: z.string(), updated_at: z.string(),
  archived_at: z.string().nullable(), revision: z.number().int().positive(),
});
export const songBulkResultSchema = z.object({
  id: uuid, organization_id: uuid, created_by: uuid, patch: songBulkPatchSchema,
  created_at: z.string(), committed_at: z.string().nullable(),
  rows: z.array(z.object({ id: uuid, before: curatedSongRowSchema, after: curatedSongRowSchema, outcome: z.literal('updated') })),
});

export const curatedSongPageSchema = z.object({
  data: z.array(curatedSongRowSchema.extend({ arrangements: z.array(curatedArrangementRowSchema), last_scheduled_at: z.string().nullable() })),
  page: z.number().int().positive(), per_page: z.number().int().positive(), total: z.number().int().nonnegative(),
});
