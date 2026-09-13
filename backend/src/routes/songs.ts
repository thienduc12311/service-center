import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  chartQuerySchema,
  createArrangementSchema,
  createSongSchema,
  listSongsQuerySchema,
  updateArrangementSchema,
  updateSongSchema,
  type ChartQuery,
  type ListSongsQuery,
  type Paginated,
  type SongListItem,
  type SongWithArrangements,
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  SONG_SELECT,
  attachLastScheduled,
  createSongWithArrangement,
  loadArrangementChart,
} from '../services/songs.js';

export const songsRouter: Router = Router();
export const arrangementsRouter: Router = Router();

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

  const payload: Paginated<SongListItem> = {
    data: await attachLastScheduled(req.db, (data ?? []) as unknown as SongWithArrangements[]),
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
  const song = await createSongWithArrangement(req.db, req.body, {
    organizationId: req.orgId,
    userId: req.auth.userId,
  });
  res.status(201).json(song);
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
 * Returns the chart in the requested key and notation. Doing this server-side
 * keeps the web and native renderers byte-for-byte identical.
 */
arrangementsRouter.get('/:id/chart', validateQuery(chartQuerySchema), async (req, res) => {
  const chart = await loadArrangementChart(req.db, param(req, 'id'), parsedQuery<ChartQuery>(res));
  res.json(chart);
});
