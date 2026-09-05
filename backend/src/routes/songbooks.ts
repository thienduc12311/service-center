import { Router } from 'express';
import { createSongbookSchema, type CreateSongbookInput, type SongbookDetail } from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export const songbooksRouter: Router = Router();

const DETAIL_SELECT = `
  *,
  items:songbook_items(
    id, sort_order,
    song:songs(id, title, author, copyright, default_key),
    arrangement:arrangements(id, name, song_key, chord_chart)
  )
`;

songbooksRouter.get('/', async (req, res) => {
  const rows = await unwrap(
    req.db
      .from('songbooks')
      .select('*')
      .eq('organization_id', req.orgId)
      .order('created_at', { ascending: false }),
  );
  res.json(rows ?? []);
});

songbooksRouter.get('/:id', async (req, res) => {
  const book = (await unwrap(
    raw(req.db)
      .from('songbooks')
      .select(DETAIL_SELECT)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  )) as SongbookDetail | null;
  if (!book) throw HttpError.notFound('Song book not found');

  book.items = [...(book.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  if (book.source_storage_path) {
    const { data } = await req.db.storage.from('songbooks').createSignedUrl(book.source_storage_path, 3600);
    book.document_url = data?.signedUrl ?? null;
  }
  res.json(book);
});

songbooksRouter.post('/', requireManager, validateBody(createSongbookSchema), async (req, res) => {
  const { songs, ...input } = req.body as CreateSongbookInput;
  if (input.source_storage_path && !input.source_storage_path.startsWith(`${req.orgId}/`)) {
    throw HttpError.badRequest('Upload the document under your organization’s folder');
  }

  if (songs.length) {
    const songIds = [...new Set(songs.map((item: { song_id: string }) => item.song_id))];
    const ownedSongs = await unwrap(
      req.db.from('songs').select('id').eq('organization_id', req.orgId).in('id', songIds),
    );
    if ((ownedSongs ?? []).length !== songIds.length) {
      throw HttpError.badRequest('Every selected song must belong to this organization');
    }

    const arrangementIds = songs
      .map((item) => item.arrangement_id)
      .filter((id): id is string => Boolean(id));
    if (arrangementIds.length) {
      const arrangements = await unwrap(
        req.db.from('arrangements').select('id, song_id').in('id', arrangementIds),
      );
      const arrangementSongs = new Map((arrangements ?? []).map((item) => [item.id, item.song_id]));
      if (songs.some((item) => item.arrangement_id && arrangementSongs.get(item.arrangement_id) !== item.song_id)) {
        throw HttpError.badRequest('Each arrangement must belong to its selected song');
      }
    }
  }

  const created = await unwrapOne(
    req.db
      .from('songbooks')
      .insert({ ...input, organization_id: req.orgId, created_by: req.auth.userId })
      .select('*')
      .single(),
  );

  if (songs.length) {
    await unwrap(
      req.db.from('songbook_items').insert(
        songs.map((item: { song_id: string; arrangement_id?: string | null }, index: number) => ({
          songbook_id: created.id,
          song_id: item.song_id,
          arrangement_id: item.arrangement_id ?? null,
          sort_order: index,
        })),
      ),
    );
  }

  const result = (await unwrapOne(
    raw(req.db).from('songbooks').select(DETAIL_SELECT).eq('id', created.id).single(),
  )) as SongbookDetail;
  res.status(201).json(result);
});

songbooksRouter.delete('/:id', requireManager, async (req, res) => {
  const deleted = await unwrap(
    req.db
      .from('songbooks')
      .delete()
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('id')
      .maybeSingle(),
  );
  if (!deleted) throw HttpError.notFound('Song book not found');
  res.status(204).end();
});
