import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  archiveMediaSchema,
  canAccessAnywhere,
  createMediaSchema,
  createPlanStageLayoutSchema,
  createStageTemplateSchema,
  deleteMediaSchema,
  deleteRevisionedSchema,
  listMediaQuerySchema,
  offlinePackRequestSchema,
  setPlanItemMediaSchema,
  updateMediaSchema,
  updatePlanStageLayoutSchema,
  updateStageTemplateSchema,
  type ArchiveMediaInput,
  type CreateMediaInput,
  type CreatePlanStageLayoutInput,
  type CreateStageTemplateInput,
  type DeleteMediaInput,
  type DeleteRevisionedInput,
  type ListMediaQuery,
  type OfflinePackRequestInput,
  type SetPlanItemMediaInput,
  type UpdateMediaInput,
  type UpdatePlanStageLayoutInput,
  type UpdateStageTemplateInput,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import type { FileCaller } from '../services/files.js';
import { archiveMedia, createMedia, deleteMedia, getMedia, listMedia, setPlanItemMedia, updateMedia } from '../services/media.js';
import { createOfflinePack, getRehearsalManifest } from '../services/rehearsal.js';
import {
  createPlanStageLayout,
  createStageTemplate,
  deletePlanStageLayout,
  deleteStageTemplate,
  listPlanStageLayouts,
  listStageTemplates,
  updatePlanStageLayout,
  updateStageTemplate,
} from '../services/stage-layouts.js';

/**
 * F14: rehearsal manifest, media bundles and stage layouts. Reads are
 * decided by RLS (and F13 file audiences); route gates only turn a refused
 * write into a clear 403 instead of an empty update.
 */
const caller = (req: Request): FileCaller => ({ db: req.db, orgId: req.orgId });

const canManageTemplates = (req: Request): boolean =>
  canAccessAnywhere(req.access, 'plans.edit') || canAccessAnywhere(req.access, 'media.manage');

const requireTemplateManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!canManageTemplates(req)) {
    next(HttpError.forbidden('You need to edit plans or manage media to change stage templates'));
    return;
  }
  next();
};

/** Mounted at `/api/v1/plans/:planId`. */
export const planRehearsalRouter: Router = Router({ mergeParams: true });

planRehearsalRouter.get('/rehearsal-manifest', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getRehearsalManifest(caller(req), param(req, 'planId')));
});

planRehearsalRouter.post('/rehearsal-manifest/offline-pack', validateBody(offlinePackRequestSchema), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await createOfflinePack(caller(req), param(req, 'planId'), req.body as OfflinePackRequestInput));
});

planRehearsalRouter.put('/items/:itemId/media', validateBody(setPlanItemMediaSchema), async (req, res) => {
  res.json(
    await setPlanItemMedia(caller(req), param(req, 'planId'), param(req, 'itemId'), req.body as SetPlanItemMediaInput),
  );
});

planRehearsalRouter.get('/stage-layouts', async (req, res) => {
  res.json(await listPlanStageLayouts(caller(req), param(req, 'planId')));
});

planRehearsalRouter.post('/stage-layouts', validateBody(createPlanStageLayoutSchema), async (req, res) => {
  res.status(201).json(await createPlanStageLayout(caller(req), param(req, 'planId'), req.body as CreatePlanStageLayoutInput));
});

planRehearsalRouter.patch('/stage-layouts/:layoutId', validateBody(updatePlanStageLayoutSchema), async (req, res) => {
  res.json(
    await updatePlanStageLayout(caller(req), param(req, 'planId'), param(req, 'layoutId'), req.body as UpdatePlanStageLayoutInput),
  );
});

planRehearsalRouter.delete('/stage-layouts/:layoutId', validateBody(deleteRevisionedSchema), async (req, res) => {
  await deletePlanStageLayout(
    caller(req),
    param(req, 'planId'),
    param(req, 'layoutId'),
    (req.body as DeleteRevisionedInput).expected_revision,
  );
  res.status(204).end();
});

/** Mounted at `/api/v1/media`. */
export const mediaRouter: Router = Router();

mediaRouter.get('/', validateQuery(listMediaQuerySchema), async (req, res) => {
  res.json(await listMedia(caller(req), parsedQuery<ListMediaQuery>(res)));
});

mediaRouter.post('/', requireCapability('media.manage'), validateBody(createMediaSchema), async (req, res) => {
  res.status(201).json(await createMedia(caller(req), req.body as CreateMediaInput));
});

mediaRouter.get('/:id', async (req, res) => {
  res.json(await getMedia(caller(req), param(req, 'id')));
});

mediaRouter.patch('/:id', requireCapability('media.manage'), validateBody(updateMediaSchema), async (req, res) => {
  res.json(await updateMedia(caller(req), param(req, 'id'), req.body as UpdateMediaInput));
});

mediaRouter.post('/:id/archive', requireCapability('media.manage'), validateBody(archiveMediaSchema), async (req, res) => {
  res.json(await archiveMedia(caller(req), param(req, 'id'), req.body as ArchiveMediaInput));
});

mediaRouter.delete('/:id', requireCapability('media.manage'), validateBody(deleteMediaSchema), async (req, res) => {
  await deleteMedia(caller(req), param(req, 'id'), (req.body as DeleteMediaInput).expected_revision);
  res.status(204).end();
});

/** Mounted at `/api/v1/stage-templates`. */
export const stageTemplatesRouter: Router = Router();

stageTemplatesRouter.get('/', async (req, res) => {
  res.json(await listStageTemplates(caller(req), canManageTemplates(req)));
});

stageTemplatesRouter.post('/', requireTemplateManager, validateBody(createStageTemplateSchema), async (req, res) => {
  res.status(201).json(await createStageTemplate(caller(req), req.body as CreateStageTemplateInput));
});

stageTemplatesRouter.patch('/:id', requireTemplateManager, validateBody(updateStageTemplateSchema), async (req, res) => {
  res.json(await updateStageTemplate(caller(req), param(req, 'id'), req.body as UpdateStageTemplateInput));
});

stageTemplatesRouter.delete('/:id', requireTemplateManager, validateBody(deleteRevisionedSchema), async (req, res) => {
  await deleteStageTemplate(caller(req), param(req, 'id'), (req.body as DeleteRevisionedInput).expected_revision);
  res.status(204).end();
});
