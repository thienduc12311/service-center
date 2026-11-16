import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  churchJoinRequestParamsSchema,
  churchLookupQuerySchema,
  createChurchJoinRequestSchema,
  declineChurchJoinRequestSchema,
  type ChurchLookupQuery,
  type CreateChurchJoinRequestInput,
  type DeclineChurchJoinRequestInput,
} from '@service-center/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { parseOrThrow, parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import {
  approveJoinRequest,
  declineJoinRequest,
  listChurchJoinRequests,
  listMyJoinRequests,
  lookupChurch,
  requestToJoin,
  withdrawMyJoinRequest,
  type ChurchOwnerCaller,
  type JoinRequesterCaller,
} from '../services/church-join-requests.js';

const requestId = (req: Request): string => parseOrThrow(churchJoinRequestParamsSchema, req.params).id;

/**
 * `/api/v1/church-join-requests`: a signed-in person asks to join a church
 * by its slug. Needs no church (mounted behind `requireAuth` only).
 */
export const churchJoinRequestsRouter: Router = Router();

const requester = (req: Request): JoinRequesterCaller => ({ db: req.db, userId: req.auth.userId });

// Slugs are short and guessable: keep lookups and requests slow enough that
// walking the slug space for church names isn't practical.
const lookupLimit = rateLimit({
  windowMs: 60_000,
  limit: config.isProduction ? 20 : 10_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** 404 `church_not_found` for an unknown or disabled church alike. */
churchJoinRequestsRouter.get('/lookup', lookupLimit, validateQuery(churchLookupQuerySchema), async (req, res) => {
  const { slug } = parsedQuery<ChurchLookupQuery>(res);
  res.json(await lookupChurch(requester(req), slug));
});

churchJoinRequestsRouter.get('/', async (req, res) => {
  res.json(await listMyJoinRequests(requester(req)));
});

churchJoinRequestsRouter.post('/', lookupLimit, validateBody(createChurchJoinRequestSchema), async (req, res) => {
  res.status(201).json(await requestToJoin(requester(req), req.body as CreateChurchJoinRequestInput));
});

churchJoinRequestsRouter.post('/:id/withdraw', async (req, res) => {
  res.json(await withdrawMyJoinRequest(requester(req), requestId(req)));
});

/**
 * `/api/v1/people/join-requests`: the active church's requests. Owners only,
 * the same people who may send invitations; the database checks it again
 * (`private.is_people_owner`).
 */
export const churchJoinRequestsOwnerRouter: Router = Router();

const requireOwner = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.orgRole !== 'owner') {
    next(HttpError.forbidden('Only the church owner can review join requests'));
    return;
  }
  next();
};

churchJoinRequestsOwnerRouter.use(requireOwner, requireCapability('people.manage'));

const owner = (req: Request): ChurchOwnerCaller => ({ db: req.db, userId: req.auth.userId, organizationId: req.orgId });

churchJoinRequestsOwnerRouter.get('/', async (req, res) => {
  res.json(await listChurchJoinRequests(owner(req)));
});

/** Sends the normal invitation; safe to retry. */
churchJoinRequestsOwnerRouter.post('/:id/approve', async (req, res) => {
  res.json(await approveJoinRequest(owner(req), requestId(req)));
});

churchJoinRequestsOwnerRouter.post('/:id/decline', validateBody(declineChurchJoinRequestSchema), async (req, res) => {
  res.json(await declineJoinRequest(owner(req), requestId(req), req.body as DeclineChurchJoinRequestInput));
});
