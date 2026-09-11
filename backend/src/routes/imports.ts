import { Router } from 'express';
import { param } from '../lib/params.js';
import { acceptImportSchema, createImportSchema, detectKey } from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { requireAdmin } from '../middleware/organization.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { processImport } from '../services/chord-import.js';
import { runAfterResponse } from '../lib/background.js';
import { consumeImportQuota, readImportQuota, toImportQuota } from '../services/import-quota.js';

export const importsRouter: Router = Router();

/**
 * Importing spends a call to an external vision model on every run, so the
 * whole feature — including reading past imports — is admin-only. Schedulers
 * still edit chord charts by hand through /songs.
 */
importsRouter.use(requireAdmin);

/** Today's remaining allowance, for the upload button to render against. */
importsRouter.get('/quota', async (req, res) => {
  const quota = await readImportQuota(req.db, req.orgId);
  res.json(toImportQuota(quota));
});

importsRouter.get('/', async (req, res) => {
  const rows = await unwrap(
    req.db
      .from('chord_sheet_imports')
      .select('*')
      .eq('organization_id', req.orgId)
      .order('created_at', { ascending: false })
      .limit(100),
  );
  res.json(rows ?? []);
});

importsRouter.get('/:id', async (req, res) => {
  const row = await unwrap(
    req.db
      .from('chord_sheet_imports')
      .select('*')
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Import not found');
  res.json(row);
});

/**
 * The client uploads straight to Supabase Storage (so large images never pass
 * through this server) and then registers the object here. OCR runs in the
 * background; the client polls or subscribes to the row for the result.
 */
importsRouter.post('/', validateBody(createImportSchema), async (req, res) => {
  const { storage_path, original_filename } = req.body as {
    storage_path: string;
    original_filename?: string | null;
  };

  // The bucket is laid out as <org_id>/<file>; refuse paths for another org.
  const owner = storage_path.replace(/^chord-sheets\//, '').split('/')[0];
  if (owner !== req.orgId) {
    throw HttpError.badRequest('Upload the file under your organization’s folder');
  }

  // Charged before the OCR job starts; a failed transcription still costs the
  // provider call, so `retry` below charges again rather than being free.
  const quota = await consumeImportQuota(req.db, req.orgId);

  const created = await unwrapOne(
    req.db
      .from('chord_sheet_imports')
      .insert({
        organization_id: req.orgId,
        created_by: req.auth.userId,
        storage_path,
        original_filename: original_filename ?? null,
        status: 'pending',
      })
      .select('*')
      .single(),
  );

  // Fire and forget — the row carries the outcome either way.
  runAfterResponse(`import ${created.id}`, processImport(created.id));

  res.status(202).json({ ...created, quota: toImportQuota(quota) });
});

importsRouter.post('/:id/retry', async (req, res) => {
  const record = await unwrap(
    req.db
      .from('chord_sheet_imports')
      .select('*')
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!record) throw HttpError.notFound('Import not found');
  if (record.status === 'processing') throw HttpError.conflict('That import is already running');

  const quota = await consumeImportQuota(req.db, req.orgId);

  runAfterResponse(`import ${record.id}`, processImport(record.id));
  res.status(202).json({ ...record, status: 'pending', quota: toImportQuota(quota) });
});

/**
 * Accepts the (possibly hand-corrected) result and turns it into a real song
 * or a new arrangement of an existing one.
 */
importsRouter.post('/:id/accept', validateBody(acceptImportSchema), async (req, res) => {
  const { title, author, song_key, chordpro, song_id, arrangement_name } = req.body as {
    title: string;
    author?: string | null;
    song_key?: string | null;
    chordpro: string;
    song_id?: string;
    arrangement_name: string;
  };

  const record = await unwrap(
    req.db
      .from('chord_sheet_imports')
      .select('id, status')
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!record) throw HttpError.notFound('Import not found');

  const key = song_key ?? detectKey(chordpro);

  const song = song_id
    ? await unwrapOne(
        req.db
          .from('songs')
          .select('*')
          .eq('id', song_id)
          .eq('organization_id', req.orgId)
          .single(),
      )
    : await unwrapOne(
        req.db
          .from('songs')
          .insert({
            organization_id: req.orgId,
            title,
            author: author ?? null,
            default_key: key,
            created_by: req.auth.userId,
          })
          .select('*')
          .single(),
      );

  const isFirstArrangement = !song_id;
  const arrangement = await unwrapOne(
    req.db
      .from('arrangements')
      .insert({
        song_id: song.id,
        name: arrangement_name,
        song_key: key,
        chord_chart: chordpro,
        chord_chart_format: 'chordpro',
        is_default: isFirstArrangement,
      })
      .select('*')
      .single(),
  );

  await unwrap(
    req.db
      .from('chord_sheet_imports')
      .update({ song_id: song.id, arrangement_id: arrangement.id })
      .eq('id', record.id),
  );

  res.status(201).json({ song, arrangement });
});
