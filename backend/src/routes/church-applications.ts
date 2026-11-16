import { Router, type Request } from 'express';
import {
  churchApplicationParamsSchema,
  submitChurchApplicationSchema,
  updateChurchApplicationSchema,
  type SubmitChurchApplicationInput,
  type UpdateChurchApplicationInput,
} from '@service-center/shared';
import { parseOrThrow, validateBody } from '../lib/validate.js';
import {
  listMyApplications,
  submitApplication,
  updateMyApplication,
  withdrawMyApplication,
  type ApplicantCaller,
} from '../services/church-applications.js';

/**
 * `/api/v1/church-applications`: a signed-in person asks to register a
 * church. Needs no church (mounted behind `requireAuth` only).
 */
export const churchApplicationsRouter: Router = Router();

const caller = (req: Request): ApplicantCaller => ({ db: req.db, userId: req.auth.userId });
const applicationId = (req: Request): string => parseOrThrow(churchApplicationParamsSchema, req.params).id;

churchApplicationsRouter.get('/', async (req, res) => {
  res.json(await listMyApplications(caller(req)));
});

/** 409 `application_pending` while another one waits for review. */
churchApplicationsRouter.post('/', validateBody(submitChurchApplicationSchema), async (req, res) => {
  res.status(201).json(await submitApplication(caller(req), req.body as SubmitChurchApplicationInput));
});

/** Only while pending (409 `application_not_pending` otherwise). */
churchApplicationsRouter.patch('/:id', validateBody(updateChurchApplicationSchema), async (req, res) => {
  res.json(await updateMyApplication(caller(req), applicationId(req), req.body as UpdateChurchApplicationInput));
});

churchApplicationsRouter.post('/:id/withdraw', async (req, res) => {
  res.json(await withdrawMyApplication(caller(req), applicationId(req)));
});
