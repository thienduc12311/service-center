import { Router, type Request } from 'express';
import {
  correctLiveRunTimeSchema,
  createLiveRunSchema,
  liveRunActionSchema,
  type CorrectLiveRunTimeInput,
  type CreateLiveRunInput,
  type LiveRunActionInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import {
  actOnLiveRun,
  correctLiveRunTime,
  createLiveRun,
  getLiveRunHistory,
  getLiveRunState,
  listPlanLiveRuns,
  type LiveCaller,
} from '../services/live-runs.js';

/**
 * F12 Live. Members read runs of plans they can see; plan editors create and
 * control them. The database decides both (RLS and the run functions); the
 * capability check here only gives a clearer early error.
 */
const caller = (req: Request): LiveCaller => ({ db: req.db, orgId: req.orgId });

export const planLiveRunsRouter: Router = Router({ mergeParams: true });

planLiveRunsRouter.get('/', async (req, res) => {
  res.json(await listPlanLiveRuns(caller(req), param(req, 'planId')));
});

planLiveRunsRouter.post('/', requireCapability('plans.edit'), validateBody(createLiveRunSchema), async (req, res) => {
  const state = await createLiveRun(caller(req), param(req, 'planId'), req.body as CreateLiveRunInput);
  res.status(state.replayed ? 200 : 201).json(state);
});

export const liveRunsRouter: Router = Router();

/** Authoritative state plus the database clock. Clients poll this; every read rechecks access. */
liveRunsRouter.get('/:id/state', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getLiveRunState(caller(req), param(req, 'id')));
});

liveRunsRouter.post('/:id/actions', requireCapability('plans.edit'), validateBody(liveRunActionSchema), async (req, res) => {
  res.json(await actOnLiveRun(caller(req), param(req, 'id'), req.body as LiveRunActionInput));
});

liveRunsRouter.get('/:id/history', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getLiveRunHistory(caller(req), param(req, 'id')));
});

liveRunsRouter.post(
  '/:id/corrections',
  requireCapability('plans.edit'),
  validateBody(correctLiveRunTimeSchema),
  async (req, res) => {
    res.json(await correctLiveRunTime(caller(req), param(req, 'id'), req.body as CorrectLiveRunTimeInput));
  },
);
