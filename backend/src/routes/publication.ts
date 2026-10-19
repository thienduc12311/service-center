import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import {
  personCalendarSharingSchema,
  publishPlanSchema,
  revokePlanPublicationSchema,
  setPublicLinkSchema,
  type PersonCalendarSharingInput,
  type PublishPlanInput,
  type RevokePlanPublicationInput,
  type SetPublicLinkInput,
} from '@service-center/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { getPersonCalendarSharing, setPersonCalendarSharing } from '../services/calendar-scoped-feeds.js';
import {
  getPlanPublication,
  publishPlan,
  resolvePublicPlan,
  resolvePublicSetList,
  revokePlanPublication,
  servicePublicLinks,
  setServicePublicLink,
  type PublicationCaller,
} from '../services/publication.js';

const caller = (req: Request): PublicationCaller => ({ db: req.db, orgId: req.orgId });

/** F16 Pass C: a plan editor's deliberate, allowlisted public projection. */
export const planPublicationRouter: Router = Router({ mergeParams: true });
planPublicationRouter.use(requireCapability('plans.edit'));

planPublicationRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getPlanPublication(caller(req), param(req, 'planId')));
});

planPublicationRouter.put('/', validateBody(publishPlanSchema), async (req, res) => {
  res.json(await publishPlan(caller(req), param(req, 'planId'), req.body as PublishPlanInput));
});

planPublicationRouter.delete('/', validateBody(revokePlanPublicationSchema), async (req, res) => {
  res.json(await revokePlanPublication(caller(req), param(req, 'planId'), (req.body as RevokePlanPublicationInput).expected_revision));
});

/** Stable per-service-type "upcoming"/"most recent" set-list links. */
export const servicePublicLinksRouter: Router = Router({ mergeParams: true });
servicePublicLinksRouter.use(requireCapability('plans.edit'));

servicePublicLinksRouter.get('/', async (req, res) => {
  res.json(await servicePublicLinks(caller(req), param(req, 'serviceTypeId')));
});

servicePublicLinksRouter.post('/', validateBody(setPublicLinkSchema), async (req, res) => {
  res.json(await setServicePublicLink(caller(req), param(req, 'serviceTypeId'), req.body as SetPublicLinkInput));
});

/** A Person's own (or a roster manager's) opt-in for calendar personal dates. */
export const personCalendarSharingRouter: Router = Router({ mergeParams: true });

personCalendarSharingRouter.get('/', async (req, res) => {
  res.json(await getPersonCalendarSharing({ db: req.db, orgId: req.orgId, userId: req.auth.userId }, param(req, 'personId')));
});

personCalendarSharingRouter.put('/', validateBody(personCalendarSharingSchema), async (req, res) => {
  res.json(
    await setPersonCalendarSharing(
      { db: req.db, orgId: req.orgId, userId: req.auth.userId },
      param(req, 'personId'),
      req.body as PersonCalendarSharingInput,
    ),
  );
});

/**
 * Anonymous. Only the allowlisted projection of a live publication ever
 * leaves here; unknown, revoked, draft or not-yet-visible all read as 404.
 */
export const publicRouter: Router = Router();
publicRouter.use(rateLimit({ windowMs: 60_000, limit: config.isProduction ? 120 : 10_000, standardHeaders: 'draft-7', legacyHeaders: false }));

publicRouter.get('/plans/:slug', async (req, res) => {
  const projection = await resolvePublicPlan(param(req, 'slug'));
  if (!projection) throw HttpError.notFound('Not found');
  res.set('Cache-Control', 'public, max-age=60');
  res.json(projection);
});

publicRouter.get('/set-lists/:slug', async (req, res) => {
  const projection = await resolvePublicSetList(param(req, 'slug'));
  if (!projection) throw HttpError.notFound('Not found');
  res.set('Cache-Control', 'public, max-age=60');
  res.json(projection);
});
