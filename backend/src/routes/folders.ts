import { Router } from 'express';
import {
  createFolderSchema,
  folderMovePreviewQuerySchema,
  moveFolderSchema,
  replaceScopeGrantsSchema,
  setLandingFolderSchema,
  updateFolderSchema,
  type CreateFolderInput,
  type MoveFolderInput,
  type ReplaceScopeGrantsInput,
  type SetLandingFolderInput,
  type UpdateFolderInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { requireAdmin } from '../middleware/organization.js';
import { buildFolderTree } from '../model/folder.model.js';
import { loadScopeAccess, replaceScopeAccess } from '../services/access.js';

/**
 * F01 extension: nested service-type folders. Everyone reads the tree;
 * structure and folder grants are administrator-only, and every move is
 * previewed, revision-checked and cycle-checked in the database.
 */
export const foldersRouter: Router = Router();

foldersRouter.get('/', async (req, res) => {
  const [folders, serviceTypes, membership, organization] = await Promise.all([
    unwrap(req.db.from('service_type_folders').select('*').eq('organization_id', req.orgId).is('archived_at', null)),
    unwrap(req.db.from('service_types').select('id, folder_id').eq('organization_id', req.orgId).is('archived_at', null)),
    unwrap(
      req.db
        .from('organization_members')
        .select('landing_folder_id')
        .eq('organization_id', req.orgId)
        .eq('user_id', req.auth.userId)
        .maybeSingle(),
    ),
    unwrap(req.db.from('organizations').select('default_folder_id').eq('id', req.orgId).maybeSingle()),
  ]);
  res.json(
    buildFolderTree(
      folders ?? [],
      serviceTypes ?? [],
      membership?.landing_folder_id ?? organization?.default_folder_id ?? null,
    ),
  );
});

foldersRouter.post('/', requireAdmin, validateBody(createFolderSchema), async (req, res) => {
  const input = req.body as CreateFolderInput;
  const created = await unwrapOne(
    req.db
      .from('service_type_folders')
      .insert({ ...input, parent_id: input.parent_id ?? null, organization_id: req.orgId, created_by: req.auth.userId })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

foldersRouter.put('/landing', validateBody(setLandingFolderSchema), async (req, res) => {
  const { folder_id } = req.body as SetLandingFolderInput;
  await unwrap(req.db.rpc('set_landing_folder', { p_org: req.orgId, p_folder: folder_id }));
  res.status(204).end();
});

foldersRouter.patch('/:id', requireAdmin, validateBody(updateFolderSchema), async (req, res) => {
  const { archived, ...fields } = req.body as UpdateFolderInput;
  const update = {
    ...fields,
    ...(archived === undefined ? {} : { archived_at: archived ? new Date().toISOString() : null }),
  };
  const updated = await unwrap(
    req.db
      .from('service_type_folders')
      .update(update)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Folder not found');
  res.json(updated);
});

/** Refused (400) while the folder still holds folders or service types. */
foldersRouter.delete('/:id', requireAdmin, async (req, res) => {
  await unwrap(
    req.db.from('service_type_folders').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId),
  );
  res.status(204).end();
});

/** Who would gain or lose inherited access if the folder moved under `parent_id`. */
foldersRouter.get('/:id/move-preview', requireAdmin, validateQuery(folderMovePreviewQuerySchema), async (req, res) => {
  const { parent_id } = parsedQuery<{ parent_id?: string }>(res);
  res.json(
    (await unwrap(req.db.rpc('preview_folder_move', { p_folder: param(req, 'id'), p_new_parent: parent_id ?? null }))) ?? [],
  );
});

foldersRouter.post('/:id/move', requireAdmin, validateBody(moveFolderSchema), async (req, res) => {
  const input = req.body as MoveFolderInput;
  const { data, error } = await req.db.rpc('move_service_type_folder', {
    p_folder: param(req, 'id'),
    p_new_parent: input.parent_id,
    p_expected_revision: input.expected_revision ?? null,
    p_acknowledge_changes: input.acknowledge_changes,
  });
  if (error?.code === 'PT409') {
    throw new HttpError(409, error.message, 'folder_move_needs_review');
  }
  if (error) throw fromPostgrestError(error);
  res.json(data);
});

foldersRouter.get('/:id/access', requireAdmin, async (req, res) => {
  res.json(await loadScopeAccess({ db: req.db, orgId: req.orgId, scopeType: 'folder', scopeId: param(req, 'id') }));
});

foldersRouter.put('/:id/access', requireAdmin, validateBody(replaceScopeGrantsSchema), async (req, res) => {
  res.json(
    await replaceScopeAccess({
      db: req.db,
      orgId: req.orgId,
      scopeType: 'folder',
      scopeId: param(req, 'id'),
      input: req.body as ReplaceScopeGrantsInput,
    }),
  );
});
