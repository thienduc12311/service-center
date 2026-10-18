import { Router, type Request } from 'express';
import {
  createReleaseBatchSchema,
  listPreparedRequestsQuerySchema,
  listReleaseBatchesQuerySchema,
  releaseBatchPreviewSchema,
  reminderPolicyScopeQuerySchema,
  updateReminderPreferencesSchema,
  upsertReminderPolicySchema,
  type CreateReleaseBatchInput,
  type ListPreparedRequestsQuery,
  type ListReleaseBatchesQuery,
  type ReleaseBatchPreviewInput,
  type ReminderPolicyScopeQuery,
  type UpdateReminderPreferencesInput,
  type UpsertReminderPolicyInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability, requireManager } from '../middleware/organization.js';
import {
  cancelReleaseBatch,
  createReleaseBatch,
  listPreparedRequests,
  listReleaseBatches,
  previewReleaseBatch,
} from '../services/releases.js';
import {
  deleteReminderPolicy,
  myReminderPreferences,
  planDeliveryHistory,
  reminderPolicyScopeView,
  saveReminderPolicy,
  updateMyReminderPreferences,
  type ReminderCaller,
} from '../services/reminders.js';

const caller = (req: Request): ReminderCaller => ({
  db: req.db,
  orgId: req.orgId,
  userId: req.auth.userId,
  orgRole: req.orgRole,
  access: req.access,
});

/**
 * F08 consolidated release: review prepared requests across plans, then
 * release now or at a scheduled time. Every row is re-checked by the
 * database (scope, revision, capability) at the moment it is released.
 */
export const releasesRouter: Router = Router();

releasesRouter.get('/prepared', requireCapability('scheduling.manage'), validateQuery(listPreparedRequestsQuerySchema), async (req, res) => {
  res.json(await listPreparedRequests(req.db, req.orgId, parsedQuery<ListPreparedRequestsQuery>(res)));
});

releasesRouter.post('/preview', requireCapability('scheduling.manage'), validateBody(releaseBatchPreviewSchema), async (req, res) => {
  const { assignment_ids } = req.body as ReleaseBatchPreviewInput;
  res.json(await previewReleaseBatch(req.db, req.orgId, assignment_ids));
});

releasesRouter.get('/', requireCapability('scheduling.manage'), validateQuery(listReleaseBatchesQuerySchema), async (req, res) => {
  res.json(await listReleaseBatches(req.db, req.orgId, parsedQuery<ListReleaseBatchesQuery>(res)));
});

releasesRouter.post('/', requireCapability('scheduling.manage'), validateBody(createReleaseBatchSchema), async (req, res) => {
  const result = await createReleaseBatch(req.db, req.orgId, req.body as CreateReleaseBatchInput);
  res.status(result.batch.status === 'scheduled' ? 202 : 201).json(result);
});

releasesRouter.post('/:id/cancel', requireCapability('scheduling.manage'), async (req, res) => {
  res.json(await cancelReleaseBatch(req.db, req.orgId, param(req, 'id')));
});

/** F08 reminder policies (team → service type → organization → default) and personal channel opt-outs. */
export const reminderPoliciesRouter: Router = Router();

// Any member manages their own channel preferences.
reminderPoliciesRouter.get('/me', async (req, res) => {
  res.json(await myReminderPreferences(caller(req)));
});
reminderPoliciesRouter.put('/me', validateBody(updateReminderPreferencesSchema), async (req, res) => {
  res.json(await updateMyReminderPreferences(caller(req), req.body as UpdateReminderPreferencesInput));
});

reminderPoliciesRouter.get('/', requireManager, validateQuery(reminderPolicyScopeQuerySchema), async (req, res) => {
  res.json(await reminderPolicyScopeView(caller(req), parsedQuery<ReminderPolicyScopeQuery>(res)));
});
reminderPoliciesRouter.put('/', requireManager, validateBody(upsertReminderPolicySchema), async (req, res) => {
  res.json(await saveReminderPolicy(caller(req), req.body as UpsertReminderPolicyInput));
});
reminderPoliciesRouter.delete('/:id', requireManager, async (req, res) => {
  await deleteReminderPolicy(caller(req), param(req, 'id'));
  res.status(204).end();
});

/** Scheduled reminders and per-Person/channel delivery history for one plan. */
export const planDeliveriesRouter: Router = Router({ mergeParams: true });

planDeliveriesRouter.get('/', requireManager, async (req, res) => {
  res.json(await planDeliveryHistory(caller(req), param(req, 'planId')));
});
