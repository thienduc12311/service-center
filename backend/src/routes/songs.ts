import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createArrangementSchema,
  createSongSchema,
  listSongsQuerySchema,
  transposeQuerySchema,
  updateArrangementSchema,
  updateSongSchema,
  semitonesBetween,
  transposeChordPro,
  type ListSongsQuery,
  type Paginated,
  type SongWithArrangements,
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export const songsRouter: Router = Router();
export const arrangementsRouter: Router = Router();

const SONG_SELECT = '*, arrangements:arrangements(*)';

songsRouter.get('/', validateQuery(listSongsQuerySchema), async (req, res) => {
  const { page, per_page, q, theme, sort } = parsedQuery<ListSongsQuery>(res);

  let query = raw(req.db)
    .from('songs')
    .select(SONG_SELECT, { count: 'exact' })
    .eq('organization_id', req.orgId);

  if (q) query = query.ilike('title', `%${q}%`);
  if (theme) query = query.contains('themes', [theme]);

  query =
    sort === 'recent'
      ? query.order('updated_at', { ascending: false })
      : query.order('title', { ascending: true });

  const from = (page - 1) * per_page;
  const { data, error, count } = await query.range(from, from + per_page - 1);
  if (error) throw new HttpError(500, error.message, error.code);

  const payload: Paginated<SongWithArrangements> = {
    data: (data ?? []) as unknown as SongWithArrangements[],
    page,
    per_page,
    total: count ?? 0,
  };
  res.json(payload);
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
  res.json(song);
});

songsRouter.post('/', requireManager, validateBody(createSongSchema), async (req, res) => {
  const song = await unwrapOne(
    req.db
      .from('songs')
      .insert({ ...req.body, organization_id: req.orgId, created_by: req.auth.userId })
      .select('*')
      .single(),
  );

  // Every song gets a default arrangement so plan items always have something
  // to point at.
  const arrangement = await unwrapOne(
    req.db
      .from('arrangements')
      .insert({
        song_id: song.id,
        name: 'Default Arrangement',
        song_key: song.default_key,
        bpm: song.default_bpm,
        meter: song.meter,
        is_default: true,
      })
      .select('*')
      .single(),
  );

  res.status(201).json({ ...song, arrangements: [arrangement] });
});

songsRouter.patch('/:id', requireManager, validateBody(updateSongSchema), async (req, res) => {
  const updated = await unwrap(
    req.db
      .from('songs')
      .update(req.body)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Song not found');
  res.json(updated);
});

songsRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('songs').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

// -------------------------------------------------------- arrangements ----
songsRouter.post(
  '/:id/arrangements',
  requireManager,
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

    // `arrangements_one_default_per_song` is a partial unique index, so an
    // existing default has to be cleared first.
    if (req.body.is_default) {
      await unwrap(
        req.db.from('arrangements').update({ is_default: false }).eq('song_id', song.id).eq('is_default', true),
      );
    }

    const created = await unwrapOne(
      req.db.from('arrangements').insert({ ...req.body, song_id: song.id }).select('*').single(),
    );
    res.status(201).json(created);
  },
);

arrangementsRouter.patch('/:id', requireManager, validateBody(updateArrangementSchema), async (req, res) => {
  if (req.body.is_default) {
    const current = await unwrap(
      req.db.from('arrangements').select('song_id').eq('id', param(req, 'id')).maybeSingle(),
    );
    if (current) {
      await unwrap(
        req.db
          .from('arrangements')
          .update({ is_default: false })
          .eq('song_id', current.song_id)
          .eq('is_default', true),
      );
    }
  }

  const updated = await unwrap(
    req.db.from('arrangements').update(req.body).eq('id', param(req, 'id')).select('*').maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Arrangement not found');
  res.json(updated);
});

arrangementsRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('arrangements').delete().eq('id', param(req, 'id')));
  res.status(204).end();
});

/**
 * Returns the chart, optionally transposed. Doing this server-side keeps the
 * web and native renderers byte-for-byte identical.
 */
arrangementsRouter.get('/:id/chart', validateQuery(transposeQuerySchema), async (req, res) => {
  const { to, semitones, prefer } = parsedQuery<{
    to?: string;
    semitones?: number;
    prefer: 'sharps' | 'flats';
  }>(res);

  const arrangement = await unwrap(
    req.db
      .from('arrangements')
      .select('id, song_key, chord_chart')
      .eq('id', param(req, 'id'))
      .maybeSingle(),
  );
  if (!arrangement) throw HttpError.notFound('Arrangement not found');
  if (!arrangement.chord_chart) {
    res.json({ chordpro: '', key: arrangement.song_key, semitones: 0 });
    return;
  }

  let shift = semitones ?? 0;
  if (to && arrangement.song_key) {
    const computed = semitonesBetween(arrangement.song_key, to);
    if (computed === null) throw HttpError.badRequest(`Unrecognised key: ${to}`);
    shift = computed;
  }

  res.json({
    chordpro: transposeChordPro(arrangement.chord_chart, shift, prefer),
    key: to ?? arrangement.song_key,
    semitones: shift,
  });
});
