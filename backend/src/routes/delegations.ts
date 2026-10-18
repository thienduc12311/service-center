import { Router, type Request } from 'express';
import {
  delegatedRespondSchema,
  grantDelegationSchema,
  type DelegatedRespondInput,
  type GrantDelegationInput,
  type ScheduleDelegationRow,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { raw } from '../lib/supabase.js';
import { fromPostgrestError } from '../lib/errors.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import {
  delegatedSchedule,
  delegationSummary,
  listDelegations,
  respondAsDelegate,
  type AvailabilityContext,
} from '../services/availability.js';

/**
 * F03 Pass C: explicit help with another person's schedule. A grant is
 * created only by the person whose schedule it is; every action below is
 * re-checked by the database against the live grant.
 */
export const delegationsRouter: Router = Router();

const context = (req: Request): AvailabilityContext => ({
  db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access,
});

delegationsRouter.get('/', async (req, res) => {
  res.json(await listDelegations(context(req)));
});

delegationsRouter.post('/', validateBody(grantDelegationSchema), async (req, res) => {
  const input = req.body as GrantDelegationInput;
  const { data, error } = await raw(req.db).rpc('grant_schedule_delegation', {
    p_organization_id: req.orgId,
    p_delegate_person_id: input.delegate_person_id,
    p_can_respond: input.can_respond,
    p_can_view_schedule: input.can_view_schedule,
    p_can_manage_availability: input.can_manage_availability,
    p_can_signup: input.can_signup,
    p_expires_at: input.expires_at ?? null,
  });
  if (error) throw fromPostgrestError(error);
  res.status(201).json(await delegationSummary(context(req), (data as ScheduleDelegationRow).id));
});

delegationsRouter.post('/:id/revoke', async (req, res) => {
  const { data, error } = await raw(req.db).rpc('revoke_schedule_delegation', { p_delegation_id: param(req, 'id') });
  if (error) throw fromPostgrestError(error);
  res.json(await delegationSummary(context(req), (data as ScheduleDelegationRow).id));
});

delegationsRouter.get('/:id/schedule', async (req, res) => {
  res.json(await delegatedSchedule(context(req), param(req, 'id')));
});

delegationsRouter.post('/:id/assignments/:assignmentId/respond', validateBody(delegatedRespondSchema), async (req, res) => {
  const input = req.body as DelegatedRespondInput;
  const outcome = await respondAsDelegate(context(req), {
    delegationId: param(req, 'id'),
    assignmentId: param(req, 'assignmentId'),
    status: input.status,
    expectedStatus: input.expected_status,
    reason: input.status === 'declined' ? input.reason?.trim() || null : null,
  });
  // The scheduler update was enqueued with the answer; deliver it after commit.
  if (outcome.result.transition !== 'unchanged') await deliverEffectNow(outcome.effectId);
  res.json(outcome.result);
});
