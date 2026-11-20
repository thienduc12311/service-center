import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  type RespondToAssignmentNotificationInput,
  respondToAssignmentNotificationSchema,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { adminDb } from '../lib/supabase.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { createResponses } from '../services/assignment-responses.js';
import { config } from '../config.js';

export const assignmentRespondRouter: Router = Router();
assignmentRespondRouter.use(rateLimit({ windowMs: 60_000, limit: config.isProduction ? 30 : 10_000, standardHeaders: 'draft-7', legacyHeaders: false }));

const responses = createResponses({ serviceDb: adminDb, deliver: deliverEffectNow });

assignmentRespondRouter.get('/:token', async (req, res) => {
  res.json(await responses.previewLink(param(req, 'token')));
});

/** Answer from the emailed respond link; the scheduler update is delivered after it commits. */
assignmentRespondRouter.post('/:token/respond', validateBody(respondToAssignmentNotificationSchema), async (req, res) => {
  const body = req.body as RespondToAssignmentNotificationInput;
  res.json(await responses.respondViaLink({ token: param(req, 'token'), status: body.status }));
});
