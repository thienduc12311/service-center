import { Router } from 'express';
import {
  externalPageQuerySchema,
  externalPlansQuerySchema,
  externalSongsQuerySchema,
  type ExternalPageQuery,
  type ExternalPlansQuery,
  type ExternalSongsQuery,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { param } from '../lib/params.js';
import { parsedQuery, validateQuery } from '../lib/validate.js';
import { requireApiKey, requireScope } from '../middleware/api-key.js';
import { externalOrganization, externalPlan, externalPlans, externalServiceTypes, externalSongs } from '../services/external-api.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** F17 external API v1: organization-credential access, read-only. */
export const externalApiRouter: Router = Router();

externalApiRouter.use(requireApiKey);

externalApiRouter.get('/organization', async (req, res) => {
  res.json({ data: await externalOrganization(req.apiCredential) });
});

externalApiRouter.get('/service-types', requireScope('plans.read'), validateQuery(externalPageQuerySchema), async (req, res) => {
  res.json(await externalServiceTypes(req.apiCredential, parsedQuery<ExternalPageQuery>(res)));
});

externalApiRouter.get('/plans', requireScope('plans.read'), validateQuery(externalPlansQuerySchema), async (req, res) => {
  res.json(await externalPlans(req.apiCredential, parsedQuery<ExternalPlansQuery>(res)));
});

externalApiRouter.get('/plans/:id', requireScope('plans.read'), async (req, res) => {
  const id = param(req, 'id');
  if (!UUID.test(id)) throw HttpError.notFound('Plan not found');
  res.json({ data: await externalPlan(req.apiCredential, id) });
});

externalApiRouter.get('/songs', requireScope('songs.read'), validateQuery(externalSongsQuerySchema), async (req, res) => {
  res.json(await externalSongs(req.apiCredential, parsedQuery<ExternalSongsQuery>(res)));
});
