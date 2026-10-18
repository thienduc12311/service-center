import { Router, type Request } from 'express';
import {
  affirmAvailabilitySchema,
  createAvailabilityRequestSchema,
  personScopeQuerySchema,
  preferenceWarningsSchema,
  previewAvailabilityRequestSchema,
  saveSchedulingPreferenceSchema,
  type AvailabilityReviewStatus,
  type CreateAvailabilityRequestInput,
  type PreferenceWarningsInput,
  type PreviewAvailabilityRequestInput,
  type SaveSchedulingPreferenceInput,
} from '@service-center/shared';
import { z } from 'zod';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { raw, unwrap } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { requireCapability } from '../middleware/organization.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { toReviewStatus } from '../model/availability.model.js';
import {
  availabilityRequestDetail,
  createAvailabilityRequest,
  listAvailabilityRequests,
  myOpenAvailabilityRequests,
  preferenceWarnings,
  previewAudience,
  resolveAvailabilityTarget,
  savePreference,
  type AvailabilityContext,
} from '../services/availability.js';

/**
 * F03 availability preferences, freshness and availability requests.
 * Blockouts themselves stay on /blockouts (MOB-006).
 */
export const availabilityRouter: Router = Router();

const context = (req: Request): AvailabilityContext => ({
  db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access,
});

type PersonScopeQuery = z.infer<typeof personScopeQuerySchema>;

// ---------------------------------------------------------- preferences ----
availabilityRouter.get('/preferences', validateQuery(personScopeQuerySchema), async (req, res) => {
  const { person_id } = parsedQuery<PersonScopeQuery>(res);
  const target = await resolveAvailabilityTarget(context(req), person_id);
  res.json((await unwrap(
    req.db.from('scheduling_preferences').select('*').eq('organization_id', req.orgId).eq('person_id', target.personId)
      .order('team_id', { ascending: true, nullsFirst: true }),
  )) ?? []);
});

availabilityRouter.put('/preferences', validateBody(saveSchedulingPreferenceSchema), async (req, res) => {
  const input = req.body as SaveSchedulingPreferenceInput;
  const target = await resolveAvailabilityTarget(context(req), input.person_id);
  res.json(await savePreference(context(req), target.personId, input));
});

availabilityRouter.delete('/preferences/:id', async (req, res) => {
  const deleted = await unwrap(
    req.db.from('scheduling_preferences').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId)
      .select('id').maybeSingle(),
  );
  if (!deleted) throw HttpError.notFound('Preference not found');
  res.status(204).end();
});

// ------------------------------------------------------------ freshness ----
availabilityRouter.get('/review', validateQuery(personScopeQuerySchema), async (req, res) => {
  const { person_id } = parsedQuery<PersonScopeQuery>(res);
  const target = await resolveAvailabilityTarget(context(req), person_id);
  const row = await unwrap(
    req.db.from('person_availability_reviews').select('reviewed_at, kind').eq('person_id', target.personId).maybeSingle(),
  );
  res.json(toReviewStatus(target.personId, row) satisfies AvailabilityReviewStatus);
});

availabilityRouter.post('/affirm', validateBody(affirmAvailabilitySchema), async (req, res) => {
  const { person_id } = req.body as z.infer<typeof affirmAvailabilitySchema>;
  const target = await resolveAvailabilityTarget(context(req), person_id);
  if (target.via === 'scheduler') {
    throw HttpError.forbidden('Only the person, or someone they asked to help, can confirm their availability');
  }
  const { data, error } = await raw(req.db).rpc('affirm_availability', {
    p_organization_id: req.orgId, p_person_id: target.personId,
  });
  if (error) throw fromPostgrestError(error);
  const row = data as { reviewed_at: string; kind: 'changed' | 'affirmed' } | null;
  res.json(toReviewStatus(target.personId, row));
});

// ------------------------------------------------------------- warnings ----
availabilityRouter.post('/warnings', requireCapability('scheduling.manage'), validateBody(preferenceWarningsSchema), async (req, res) => {
  res.json(await preferenceWarnings(context(req), req.body as PreferenceWarningsInput));
});

// ------------------------------------------------- availability requests --
availabilityRouter.get('/requests/mine', async (req, res) => {
  res.json(await myOpenAvailabilityRequests(context(req)));
});

availabilityRouter.post('/requests/preview', requireCapability('scheduling.manage'), validateBody(previewAvailabilityRequestSchema), async (req, res) => {
  const { team_id } = req.body as PreviewAvailabilityRequestInput;
  res.json(await previewAudience(context(req), team_id));
});

availabilityRouter.post('/requests', requireCapability('scheduling.manage'), validateBody(createAvailabilityRequestSchema), async (req, res) => {
  const result = await createAvailabilityRequest(context(req), req.body as CreateAvailabilityRequestInput);
  // Delivery runs after the commit; a replay re-runs only what is still queued.
  await deliverEffectNow(result.effect_id);
  res.status(result.replayed ? 200 : 201).json(result);
});

const listRequestsQuerySchema = z.object({ team_id: z.string().uuid().optional() });
availabilityRouter.get('/requests', validateQuery(listRequestsQuerySchema), async (req, res) => {
  const { team_id } = parsedQuery<z.infer<typeof listRequestsQuerySchema>>(res);
  res.json(await listAvailabilityRequests(context(req), team_id));
});

availabilityRouter.get('/requests/:id', async (req, res) => {
  res.json(await availabilityRequestDetail(context(req), param(req, 'id')));
});
