import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  arrangementMaterialsSchema, labeledKeyInputSchema, labeledKeySchema,
  duplicateArrangementSchema, duplicateCommitSchema, duplicatePreviewSchema, duplicateResultSchema,
  duplicateSongsSchema, songMergeInputSchema, songMergeCommitSchema, songMergePreviewSchema, songMergeResultSchema,
  type ArrangementRow, type LabeledKeyInput, type DuplicateArrangementInput, type DuplicateArrangementCommit, type SongMergeInput, type SongMergeCommit,
  chartQuerySchema,
  songBulkPreviewSchema, songBulkCommitSchema, songArchiveSchema,
  curatedSongPageSchema, songBulkResultSchema, curatedSongRowSchema, curatedArrangementRowSchema,
  type SongBulkPreviewInput, type SongBulkCommitInput, type SongArchiveInput,
  createArrangementSchema,
  createSongSchema,
  listSongsQuerySchema,
  songScheduleQuerySchema,
  updateArrangementSchema,
  updateSongSchema,
  type ChartQuery,
  type ListSongsQuery,
  type SongScheduleQuery,
  type UpdateArrangementInput,
  type UpdateSongInput,
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  SONG_SELECT,
  createSongWithArrangement,
  loadArrangementChart,
  loadSongSchedule,
} from '../services/songs.js';

export const songsRouter: Router = Router();
export const arrangementsRouter: Router = Router();

songsRouter.get('/', validateQuery(listSongsQuerySchema), async (req, res) => {
  const payload: unknown = await unwrap(raw(req.db).rpc('list_curated_songs', {
    p_org: req.orgId, p_query: parsedQuery<ListSongsQuery>(res),
  }));
  res.json(curatedSongPageSchema.parse(payload));
});

songsRouter.post('/bulk/preview', requireCapability('songs.manage'), validateBody(songBulkPreviewSchema), async (req, res) => {
  const body = req.body as SongBulkPreviewInput;
  const result: unknown = await unwrap(raw(req.db).rpc('preview_song_bulk', { p_org: req.orgId, p_rows: body.rows, p_patch: body.patch }));
  res.json(songBulkResultSchema.parse(result));
});
songsRouter.post('/bulk', requireCapability('songs.manage'), validateBody(songBulkCommitSchema), async (req, res) => {
  const body = req.body as SongBulkCommitInput;
  const result: unknown = await unwrap(raw(req.db).rpc('commit_song_bulk', { p_org: req.orgId, p_preview: body.preview_id }));
  res.json(songBulkResultSchema.parse(result));
});
songsRouter.get('/:id/duplicates', requireCapability('songs.manage'), async (req, res) => {
  const result: unknown = await unwrap(raw(req.db).rpc('song_duplicate_candidates', { p_org: req.orgId, p_song: param(req, 'id') }));
  res.json(duplicateSongsSchema.parse(result));
});
songsRouter.post('/merge/preview', requireCapability('songs.manage'), validateBody(songMergeInputSchema), async (req, res) => {
  const body = req.body as SongMergeInput;
  const result: unknown = await unwrap(raw(req.db).rpc('preview_song_merge', { p_org: req.orgId, p_winner: body.winner_id, p_loser: body.loser_id }));
  res.json(songMergePreviewSchema.parse(result));
});
songsRouter.post('/merge', requireCapability('songs.manage'), validateBody(songMergeCommitSchema), async (req, res) => {
  const body = req.body as SongMergeCommit;
  const result: unknown = await unwrap(raw(req.db).rpc('commit_song_merge', { p_org: req.orgId, p_winner: body.winner_id, p_loser: body.loser_id, p_fingerprint: body.fingerprint, p_key: body.idempotency_key }));
  res.json(songMergeResultSchema.parse(result));
});
arrangementsRouter.get('/:id/materials', async (req, res) => {
  const result: unknown = await unwrap(raw(req.db).rpc('arrangement_materials', { p_org: req.orgId, p_arrangement: param(req, 'id') }));
  res.json(arrangementMaterialsSchema.parse(result));
});
arrangementsRouter.post('/:id/keys', requireCapability('songs.manage'), validateBody(labeledKeyInputSchema), async (req, res) => {
  const body = req.body as LabeledKeyInput;
  const result: unknown = await unwrap(raw(req.db).rpc('save_arrangement_key', { p_org: req.orgId, p_arrangement: param(req, 'id'), p_input: body }));
  res.json(labeledKeySchema.parse(result));
});
arrangementsRouter.post('/:id/duplicate/preview', requireCapability('songs.manage'), validateBody(duplicateArrangementSchema), async (req, res) => {
  const body = req.body as DuplicateArrangementInput;
  const result: unknown = await unwrap(raw(req.db).rpc('preview_arrangement_duplicate', { p_org: req.orgId, p_arrangement: param(req, 'id'), p_input: body }));
  res.json(duplicatePreviewSchema.parse(result));
});
arrangementsRouter.post('/:id/duplicate', requireCapability('songs.manage'), validateBody(duplicateCommitSchema), async (req, res) => {
  const { fingerprint, idempotency_key, ...selection } = req.body as DuplicateArrangementCommit;
  const result: unknown = await unwrap(raw(req.db).rpc('duplicate_arrangement', { p_org: req.orgId, p_arrangement: param(req, 'id'), p_input: selection, p_fingerprint: fingerprint, p_key: idempotency_key }));
  res.status(201).json(duplicateResultSchema.parse(result));
});
songsRouter.post('/:id/archive', requireCapability('songs.manage'), validateBody(songArchiveSchema), async (req, res) => {
  const body = req.body as SongArchiveInput;
  const result: unknown = await unwrap(raw(req.db).rpc('archive_library_record', {
    p_org: req.orgId, p_kind: 'song', p_id: param(req, 'id'), p_revision: body.expected_revision, p_archived: body.archived,
  }));
  res.json(curatedSongRowSchema.parse(result));
});
arrangementsRouter.post('/:id/archive', requireCapability('songs.manage'), validateBody(songArchiveSchema), async (req, res) => {
  const body = req.body as SongArchiveInput;
  const result: unknown = await unwrap(raw(req.db).rpc('archive_library_record', {
    p_org: req.orgId, p_kind: 'arrangement', p_id: param(req, 'id'), p_revision: body.expected_revision, p_archived: body.archived,
  }));
  res.json(curatedArrangementRowSchema.parse(result));
});

songsRouter.get('/:id', async (req, res) => {
  const song = await unwrap(
    raw(req.db)
      .from('songs')
      .select(SONG_SELECT)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!song) throw HttpError.notFound('Song not found');
  const row = song as { merged_into_song_id?: string | null; merged_default_arrangement_id?: string | null };
  if (row.merged_into_song_id) {
    const arrangements = await unwrap(raw(req.db).from('arrangements').select('*').eq('song_id', row.merged_into_song_id));
    const canonical = await unwrap(req.db.from('songs').select('default_key, default_bpm, meter').eq('id', row.merged_into_song_id).eq('organization_id', req.orgId).maybeSingle());
    res.json({ ...song, arrangements: (arrangements ?? []).map((a: ArrangementRow) => ({ ...a,
      song_key: a.song_key ?? canonical?.default_key ?? null,
      bpm: a.bpm ?? canonical?.default_bpm ?? null, meter: a.meter ?? canonical?.meter ?? null,
      is_default: a.id === row.merged_default_arrangement_id,
    })) });
    return;
  }
  res.json(song);
});

/** The services this song was scheduled in — the song page's Schedule panel. */
songsRouter.get('/:id/schedule', validateQuery(songScheduleQuerySchema), async (req, res) => {
  const source = await unwrap(req.db.from('songs').select('id, merged_into_song_id').eq('id', param(req, 'id')).eq('organization_id', req.orgId).maybeSingle());
  if (!source) throw HttpError.notFound('Song not found');
  const schedule = await loadSongSchedule(
    req.db,
    source.merged_into_song_id ?? source.id,
    req.orgId,
    parsedQuery<SongScheduleQuery>(res),
  );
  res.json(schedule);
});

songsRouter.post('/', requireCapability('songs.manage'), validateBody(createSongSchema), async (req, res) => {
  const song = await createSongWithArrangement(req.db, req.body, {
    organizationId: req.orgId,
    userId: req.auth.userId,
  });
  res.status(201).json(song);
});

/**
 * With `expected_revision` the update only matches the revision the editor
 * opened (the trigger then advances it), so a competing save is refused as
 * stale instead of silently overwriting the newer edit. Without it, the
 * legacy last-write-wins contract stands.
 */
songsRouter.patch('/:id', requireCapability('songs.manage'), validateBody(updateSongSchema), async (req, res) => {
  const { expected_revision: expectedRevision, ...changes } = req.body as UpdateSongInput;
  const id = param(req, 'id');
  let update = req.db.from('songs').update(changes).eq('id', id).eq('organization_id', req.orgId);
  if (expectedRevision !== undefined) update = update.eq('revision', expectedRevision);
  const updated = await unwrap(update.select('*').maybeSingle());
  if (!updated) {
    if (expectedRevision !== undefined) {
      const current = await unwrap(req.db.from('songs').select('id').eq('id', id).eq('organization_id', req.orgId).maybeSingle());
      if (current) throw new HttpError(409, 'This song changed since it was opened', 'song_revision_stale');
    }
    throw HttpError.notFound('Song not found');
  }
  res.json(updated);
});

songsRouter.delete('/:id', requireCapability('songs.manage'), async (req, res) => {
  await unwrap(req.db.from('songs').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

// -------------------------------------------------------- arrangements ----
songsRouter.post(
  '/:id/arrangements',
  requireCapability('songs.manage'),
  validateBody(createArrangementSchema),
  async (req, res) => {
    const song = await unwrap(
      req.db
        .from('songs')
        .select('id')
        .eq('id', param(req, 'id'))
        .eq('organization_id', req.orgId)
        .maybeSingle(),
    );
    if (!song) throw HttpError.notFound('Song not found');

    const created = await unwrapOne(
      req.db.from('arrangements').insert({ ...req.body, song_id: song.id }).select('*').single(),
    );
    res.status(201).json(created);
  },
);

/** Same revision contract as the song update above. */
arrangementsRouter.patch('/:id', requireCapability('songs.manage'), validateBody(updateArrangementSchema), async (req, res) => {
  const { expected_revision: expectedRevision, ...changes } = req.body as UpdateArrangementInput;
  const id = param(req, 'id');
  let update = req.db.from('arrangements').update(changes).eq('id', id);
  if (expectedRevision !== undefined) update = update.eq('revision', expectedRevision);
  const updated = await unwrap(update.select('*').maybeSingle());
  if (!updated) {
    if (expectedRevision !== undefined) {
      const current = await unwrap(req.db.from('arrangements').select('id').eq('id', id).maybeSingle());
      if (current) throw new HttpError(409, 'This arrangement changed since it was opened', 'arrangement_revision_stale');
    }
    throw HttpError.notFound('Arrangement not found');
  }
  res.json(updated);
});

arrangementsRouter.delete('/:id', requireCapability('songs.manage'), async (req, res) => {
  await unwrap(req.db.from('arrangements').delete().eq('id', param(req, 'id')));
  res.status(204).end();
});

/**
 * Returns the chart in the requested key and notation. Doing this server-side
 * keeps the web and native renderers byte-for-byte identical.
 */
arrangementsRouter.get('/:id/chart', validateQuery(chartQuerySchema), async (req, res) => {
  const chart = await loadArrangementChart(req.db, param(req, 'id'), parsedQuery<ChartQuery>(res));
  res.json(chart);
});
