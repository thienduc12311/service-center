import { Router, type Request } from 'express';
import { param } from '../lib/params.js';
import {
  createPlanItemSchema,
  createPlanPositionSchema,
  createPlanSchema,
  type CreatePlanPositionInput,
  type PlanDetail,
  duplicatePlanSchema,
  importPlanContentsSchema,
  listPlansQuerySchema,
  reorderPlanItemsSchema,
  setPlanPositionNeedsSchema,
  updatePlanItemSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type CreatePlanItemInput,
  type DuplicatePlanInput,
  type ImportPlanContentsInput,
  type ImportPlanContentsResult,
  type ListPlansQuery,
  type Paginated,
  type PlanSummary,
  type SetPlanPositionNeedsInput,
  type UpdatePlanInput,
  type UpdatePlanResult,
  type AssignmentNotificationSendResult,
  type PlanPublishPreview,
  previewPlanTimesSchema,
  type PreviewPlanTimesInput,
  type PlanTimeChangeResult,
  type PlanTimeImpact,
  canAccessAnywhere,
  deletePlanItemQuerySchema,
  planScheduleQuerySchema,
  type DeletePlanItemQuery,
  type PlanScheduleQuery,
  type ReorderPlanItemsInput,
  type UpdatePlanItemInput,
} from '@service-center/shared';
import { randomUUID } from 'node:crypto';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability, requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne, unwrapDeleted } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { rawSelect, whereSearchMatches, type RawQuery } from '../lib/search.js';
import {
  PLAN_SUMMARY_SELECT,
  createPlanAtomically,
  duplicatePlanAtomically,
  fetchPlanDetail,
  fetchViewerIsAdultPerson,
  importPlanContents,
  setPlanPositionNeeds,
  shapePlanSummary,
} from '../services/plans.js';
import { addPlanItem, deletePlanItem, planScheduleFor, reorderPlanItems, updatePlanItem } from '../services/plan-items.js';
import { notifyConfirmedAssignmentsForPlan } from './assignments.js';
import { identifyPlanTimes, previewPlanTimes, updatePlanWithTimes, type PlanFieldsPatch } from '../services/attendance.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { notificationSendResult } from '../services/deliveries.js';
import { planPublishPreview, publishPlan } from '../services/plan-publish.js';
import { publishEffectKey } from '../model/plan-publish.model.js';

export const plansRouter: Router = Router();

/** The list filters that decide which plans are counted. */
type PlanListFilters = Pick<ListPlansQuery, 'q' | 'status' | 'service_type_id' | 'from' | 'to'>;

/** Narrows a plans query to the list filters (title search: accent-insensitive, every word). */
const applyPlanListFilters = (query: RawQuery, orgId: string, filters: PlanListFilters): RawQuery => {
  let narrowed = query.eq('organization_id', orgId);
  if (filters.status) narrowed = narrowed.eq('status', filters.status);
  if (filters.service_type_id) narrowed = narrowed.eq('service_type_id', filters.service_type_id);
  if (filters.from) narrowed = narrowed.gte('service_date', filters.from);
  if (filters.to) narrowed = narrowed.lte('service_date', filters.to);
  return whereSearchMatches(narrowed, filters.q);
};

const countPlans = async (req: Request, filters: PlanListFilters): Promise<number> => {
  const query = applyPlanListFilters(rawSelect(req.db, 'plans', 'id', { count: 'exact', head: true }), req.orgId, filters);
  const { count, error } = await query;
  if (error) throw fromPostgrestError(error);
  return count ?? 0;
};

plansRouter.get('/', validateQuery(listPlansQuerySchema), async (req, res) => {
  const { page, per_page, q, status, service_type_id, from, to, order } =
    parsedQuery<ListPlansQuery>(res);
  const filters: PlanListFilters = { q, status, service_type_id, from, to };

  const query = applyPlanListFilters(
    rawSelect(req.db, 'plans', PLAN_SUMMARY_SELECT, { count: 'exact' }),
    req.orgId,
    filters,
  );

  const offset = (page - 1) * per_page;
  const { data, error, count } = await query
    .order('service_date', { ascending: order === 'asc' })
    // Tie-breaker: equal dates keep one order across pages and in both directions.
    .order('id', { ascending: order === 'asc' })
    .range(offset, offset + per_page - 1);

  // A page past the end is an empty page, not an error (W2-PLANS-D2).
  // PostgREST answers it with PGRST103 and no count, so count separately.
  if (error?.code === 'PGRST103') {
    const beyond: Paginated<PlanSummary> = { data: [], page, per_page, total: await countPlans(req, filters) };
    res.json(beyond);
    return;
  }
  if (error) throw fromPostgrestError(error);

  const payload: Paginated<PlanSummary> = {
    data: (data ?? []).map((row) => shapePlanSummary(row as never)),
    page,
    per_page,
    total: count ?? 0,
  };
  res.json(payload);
});

plansRouter.get('/:id', async (req, res) => {
  const [detail, viewerIsAdultPerson] = await Promise.all([
    fetchPlanDetail(req.db, req.orgId, param(req, 'id')),
    fetchViewerIsAdultPerson(req.db, req.orgId, req.auth.userId),
  ]);
  const payload: PlanDetail = { ...detail, viewer_is_adult_person: viewerIsAdultPerson };
  res.json(payload);
});

/**
 * Creates the plan, its times and anything copied from another plan in one
 * transaction; a retry with the same idempotency key returns the same plan.
 */
plansRouter.post('/', requireCapability('plans.edit'), validateBody(createPlanSchema), async (req, res) => {
  const planId = await createPlanAtomically({
    db: req.db,
    orgId: req.orgId,
    input: req.body as CreatePlanInput,
  });
  res.status(201).json(await fetchPlanDetail(req.db, req.orgId, planId));
});

/**
 * F04: what saving this complete time list would do — which requests gain,
 * lose or change attendance, which selected requests would be left without a
 * time, and which outstanding requests would have to be answered again.
 */
plansRouter.post('/:id/times/preview', requireCapability('plans.edit'), validateBody(previewPlanTimesSchema), async (req, res) => {
  const planId = param(req, 'id');
  const { times } = req.body as PreviewPlanTimesInput;
  await unwrapOne(req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).single());
  const ctx = { db: req.db, orgId: req.orgId, planId };
  const identified = await identifyPlanTimes(ctx, times);
  const impact: PlanTimeImpact = await previewPlanTimes(ctx, identified, canAccessAnywhere(req.access, 'scheduling.manage'));
  res.json(impact);
});

/** F04: requests on this plan committed over a conflict, with who and why (RLS-scoped). */
plansRouter.get('/:id/conflict-overrides', requireCapability('scheduling.manage'), async (req, res) => {
  res.json(
    (await unwrap(
      req.db
        .from('assignment_conflict_overrides')
        .select('*')
        .eq('plan_id', param(req, 'id'))
        .eq('organization_id', req.orgId)
        .order('created_at', { ascending: false }),
    )) ?? [],
  );
});

plansRouter.patch('/:id', requireCapability('plans.edit'), validateBody(updatePlanSchema), async (req, res) => {
  const {
    times,
    expected_revision,
    time_impact_hash,
    orphan_resolutions,
    notify_time_changes,
    notify,
    idempotency_key,
    ...fields
  } = req.body as UpdatePlanInput;
  const planId = param(req, 'id');
  const existingPlan = await unwrapOne(req.db.from('plans').select('id, location, organization_id, content_revision').eq('id', planId).eq('organization_id', req.orgId).single());
  // ADR-0006: publishing goes through publish_plan_notify, after the other
  // fields are saved, so the request describes the saved plan.
  const { status, ...otherFields } = fields;
  const publishing = status === 'published';
  const plan: PlanFieldsPatch = publishing ? otherFields : fields;

  // F04 + W8-RES-D4: one transaction locks the plan, checks its revision and the
  // previewed impact, replaces the times (keeping time ids across reorder,
  // resolving/staling/re-sending requests) AND updates the other plan fields.
  // A failure of either rolls back both, so a retry with the same
  // `expected_revision` is not a false 409. When `service_date` and `times` are
  // both sent, the times win (the date follows the earliest service time).
  // Without an impact hash it refuses to remove anyone's selected time.
  const ctx = { db: req.db, orgId: req.orgId, planId };
  const hasChange = times !== undefined || Object.keys(plan).length > 0;
  const timeChange: PlanTimeChangeResult | null = hasChange
    ? await updatePlanWithTimes(ctx, {
        times: times ? await identifyPlanTimes(ctx, times) : null,
        fields: plan,
        expectedRevision: expected_revision ?? existingPlan.content_revision,
        impactHash: time_impact_hash ?? null,
        orphanResolutions: orphan_resolutions,
        notify: notify_time_changes,
        effectKey: `plan-times:${planId}:${randomUUID()}`,
      })
    : null;

  if (timeChange?.effect_id) await deliverEffectNow(timeChange.effect_id);
  // A new place (no time change) still matters to the people who said yes.
  if (plan.location !== undefined && plan.location !== existingPlan.location) {
    await notifyConfirmedAssignmentsForPlan({ db: req.db, orgId: req.orgId, planId: existingPlan.id });
  }

  let publishNotification: AssignmentNotificationSendResult | null | undefined;
  if (publishing) {
    const published = await publishPlan(req.db, {
      planId,
      notify,
      effectKey: publishEffectKey(planId, idempotency_key ?? randomUUID()),
    });
    await deliverEffectNow(published.effectId);
    publishNotification = published.effectId ? await notificationSendResult(req.db, published.effectId) : null;
  }

  const detail = await fetchPlanDetail(req.db, req.orgId, planId);
  const payload: UpdatePlanResult = publishing ? { ...detail, publish_notification: publishNotification } : detail;
  res.json(payload);
});

/** ADR-0006: who publishing this plan would email, and who has no address. */
plansRouter.get('/:id/publish-preview', requireCapability('plans.edit'), async (req, res) => {
  const planId = param(req, 'id');
  await unwrapOne(req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).single());
  const preview: PlanPublishPreview = await planPublishPreview(req.db, planId);
  res.json(preview);
});

plansRouter.delete('/:id', requireCapability('plans.edit'), async (req, res) => {
  await unwrapDeleted(
    req.db.from('plans').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId).select('id'),
    'Plan not found',
  );
  res.status(204).end();
});

/**
 * "Same as last week" — the single most-used action in a scheduling tool.
 * One transaction: order, times (shifted by the date change), needs and,
 * optionally, the team as fresh unconfirmed requests. Nobody is notified.
 */
plansRouter.post('/:id/duplicate', requireCapability('plans.edit'), validateBody(duplicatePlanSchema), async (req, res) => {
  const planId = await duplicatePlanAtomically({
    db: req.db,
    sourcePlanId: param(req, 'id'),
    input: req.body as DuplicatePlanInput,
  });
  res.status(201).json(await fetchPlanDetail(req.db, req.orgId, planId));
});

/**
 * Copies another plan's order, needs and/or team into this plan in one
 * transaction. Nothing already on the plan is removed and nobody is notified.
 */
plansRouter.post('/:id/import', requireCapability('plans.edit'), validateBody(importPlanContentsSchema), async (req, res) => {
  const targetPlanId = param(req, 'id');
  const contentRevision = await importPlanContents({
    db: req.db,
    orgId: req.orgId,
    targetPlanId,
    input: req.body as ImportPlanContentsInput,
  });
  const result: ImportPlanContentsResult = {
    plan: await fetchPlanDetail(req.db, req.orgId, targetPlanId),
    content_revision: contentRevision,
  };
  res.json(result);
});

// --------------------------------------------------------------- items ----
/**
 * F11: adds an item at the end of the order (or at `sort_order`). With
 * `idempotency_key`, a retry returns the item already made with 200 instead
 * of adding it twice. The response adds the plan's new revision.
 */
plansRouter.post('/:id/items', requireCapability('plans.edit'), validateBody(createPlanItemSchema), async (req, res) => {
  const result = await addPlanItem({
    db: req.db,
    orgId: req.orgId,
    planId: param(req, 'id'),
    input: req.body as CreatePlanItemInput,
  });
  res.status(result.replayed ? 200 : 201).json({ ...result.item, content_revision: result.content_revision });
});

/**
 * F11: edits an item in place (same id and position). With
 * `expected_revision`, an edit over someone else's change is a 409
 * `plan_revision_stale`. The response adds the plan's new revision.
 */
plansRouter.patch('/:id/items/:itemId', requireCapability('plans.edit'), validateBody(updatePlanItemSchema), async (req, res) => {
  const result = await updatePlanItem({
    db: req.db,
    planId: param(req, 'id'),
    itemId: param(req, 'itemId'),
    input: req.body as UpdatePlanItemInput,
  });
  res.json({ ...result.item, content_revision: result.content_revision });
});

plansRouter.delete('/:id/items/:itemId', requireCapability('plans.edit'), validateQuery(deletePlanItemQuerySchema), async (req, res) => {
  const { expected_revision } = parsedQuery<DeletePlanItemQuery>(res);
  await deletePlanItem(req.db, param(req, 'id'), param(req, 'itemId'), expected_revision);
  res.status(204).end();
});

/** F11: planned item times for one service time — derived, never stored. */
plansRouter.get('/:id/schedule', validateQuery(planScheduleQuerySchema), async (req, res) => {
  const { time_id } = parsedQuery<PlanScheduleQuery>(res);
  const plan = await fetchPlanDetail(req.db, req.orgId, param(req, 'id'));
  res.json(planScheduleFor(plan, time_id));
});

// ----------------------------------------------------- needed positions ----
/** Drives the "Edit needed positions" panel on the plan's Teams tab. */
plansRouter.put(
  '/:id/position-needs',
  requireManager,
  validateBody(setPlanPositionNeedsSchema),
  async (req, res) => {
    const { needs } = req.body as SetPlanPositionNeedsInput;

    res.json(
      await setPlanPositionNeeds({
        db: req.db,
        orgId: req.orgId,
        planId: param(req, 'id'),
        needs,
      }),
    );
  },
);

/**
 * A position for this plan only (F02): owned by a team, never added to the
 * team's normal list. Anyone who schedules that team on this plan may add or
 * remove one; removing one someone holds is refused.
 */
plansRouter.post('/:id/positions', requireCapability('scheduling.manage'), validateBody(createPlanPositionSchema), async (req, res) => {
  const body = req.body as CreatePlanPositionInput;
  const { data, error } = await req.db.rpc('create_plan_position', {
    p_plan: param(req, 'id'),
    p_team: body.team_id,
    p_name: body.name,
    p_needed: body.needed,
  });
  if (error?.code === 'PT409') throw new HttpError(409, error.message, 'plan_position_exists');
  if (error) throw fromPostgrestError(error);
  res.status(201).json(data);
});

plansRouter.delete('/:id/positions/:positionId', requireCapability('scheduling.manage'), async (req, res) => {
  const position = await unwrap(
    req.db.from('team_positions').select('id').eq('id', param(req, 'positionId')).eq('plan_id', param(req, 'id')).maybeSingle(),
  );
  if (!position) throw HttpError.notFound('Position not found');
  const { error } = await req.db.rpc('delete_plan_position', { p_position: position.id });
  if (error?.code === 'PT409') throw new HttpError(409, error.message, 'plan_position_in_use');
  if (error) throw fromPostgrestError(error);
  res.status(204).end();
});

/** Persists a reorder in one transaction: the ids arrive in their new order. */
plansRouter.put('/:id/items/order', requireCapability('plans.edit'), validateBody(reorderPlanItemsSchema), async (req, res) => {
  const { item_ids, expected_revision } = req.body as ReorderPlanItemsInput;

  res.json(
    await reorderPlanItems({ db: req.db, planId: param(req, 'id'), itemIds: item_ids, expectedRevision: expected_revision }),
  );
});
