import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createPlanItemSchema,
  createPlanPositionSchema,
  createPlanSchema,
  type CreatePlanPositionInput,
  duplicatePlanSchema,
  importPlanContentsSchema,
  listPlansQuerySchema,
  reorderPlanItemsSchema,
  setPlanPositionNeedsSchema,
  updatePlanItemSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type DuplicatePlanInput,
  type ImportPlanContentsInput,
  type ImportPlanContentsResult,
  type ListPlansQuery,
  type Paginated,
  type PlanSummary,
  type SetPlanPositionNeedsInput,
  type UpdatePlanInput,
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
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import {
  PLAN_SUMMARY_SELECT,
  createPlanAtomically,
  duplicatePlanAtomically,
  fetchPlanDetail,
  importPlanContents,
  setPlanPositionNeeds,
  shapePlanSummary,
} from '../services/plans.js';
import { deletePlanItem, planScheduleFor, reorderPlanItems, updatePlanItem } from '../services/plan-items.js';
import { notifyConfirmedAssignmentsForPlan } from './assignments.js';
import { applyPlanTimes, identifyPlanTimes, previewPlanTimes } from '../services/attendance.js';
import { deliverEffectNow } from '../services/delivery-worker.js';

export const plansRouter: Router = Router();

plansRouter.get('/', validateQuery(listPlansQuerySchema), async (req, res) => {
  const { page, per_page, status, service_type_id, from, to, order } =
    parsedQuery<ListPlansQuery>(res);

  let query = raw(req.db)
    .from('plans')
    .select(PLAN_SUMMARY_SELECT, { count: 'exact' })
    .eq('organization_id', req.orgId);

  if (status) query = query.eq('status', status);
  if (service_type_id) query = query.eq('service_type_id', service_type_id);
  if (from) query = query.gte('service_date', from);
  if (to) query = query.lte('service_date', to);

  const offset = (page - 1) * per_page;
  const { data, error, count } = await query
    .order('service_date', { ascending: order === 'asc' })
    // Tie-breaker: equal dates keep one order across pages and in both directions.
    .order('id', { ascending: order === 'asc' })
    .range(offset, offset + per_page - 1);

  if (error) throw new HttpError(500, error.message, error.code);

  const payload: Paginated<PlanSummary> = {
    data: (data ?? []).map((row) => shapePlanSummary(row as never)),
    page,
    per_page,
    total: count ?? 0,
  };
  res.json(payload);
});

plansRouter.get('/:id', async (req, res) => {
  res.json(await fetchPlanDetail(req.db, req.orgId, param(req, 'id')));
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
    ...plan
  } = req.body as UpdatePlanInput;
  const planId = param(req, 'id');
  const existingPlan = await unwrapOne(req.db.from('plans').select('id, location, organization_id, content_revision').eq('id', planId).eq('organization_id', req.orgId).single());

  // F04: one transaction locks the plan, checks its revision and the previewed
  // impact, keeps time ids across reorder, resolves requests left without a
  // time, makes outstanding requests stale and re-sends the affected ones.
  // Without an impact hash it refuses to remove anyone's selected time.
  let timeChange: PlanTimeChangeResult | null = null;
  if (times) {
    const ctx = { db: req.db, orgId: req.orgId, planId };
    timeChange = await applyPlanTimes(ctx, {
      times: await identifyPlanTimes(ctx, times),
      expectedRevision: expected_revision ?? existingPlan.content_revision,
      impactHash: time_impact_hash ?? null,
      orphanResolutions: orphan_resolutions,
      notify: notify_time_changes,
      effectKey: `plan-times:${planId}:${randomUUID()}`,
    });
  }

  // Do this after the versioned time replacement so a stale time editor cannot
  // partially apply unrelated plan fields before receiving its 409.
  if (Object.keys(plan).length > 0) {
    const updated = await unwrap(
      req.db
        .from('plans')
        .update(plan)
        .eq('id', planId)
        .eq('organization_id', req.orgId)
        .select('id')
        .maybeSingle(),
    );
    if (!updated) throw HttpError.notFound('Plan not found');
  }

  if (timeChange?.effect_id) await deliverEffectNow(timeChange.effect_id);
  // A new place (no time change) still matters to the people who said yes.
  if (plan.location !== undefined && plan.location !== existingPlan.location) {
    await notifyConfirmedAssignmentsForPlan({ db: req.db, orgId: req.orgId, planId: existingPlan.id });
  }

  res.json(await fetchPlanDetail(req.db, req.orgId, planId));
});

plansRouter.delete('/:id', requireCapability('plans.edit'), async (req, res) => {
  await unwrap(req.db.from('plans').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
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
plansRouter.post('/:id/items', requireCapability('plans.edit'), validateBody(createPlanItemSchema), async (req, res) => {
  const body = req.body as Record<string, unknown> & { song_id?: string | null; title?: string };

  const plan = await unwrap(
    req.db.from('plans').select('id').eq('id', param(req, 'id')).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  // A song item may omit the title; fall back to the song's own.
  if (body.item_type === 'song' && !body.title && body.song_id) {
    const song = await unwrap(req.db.from('songs').select('title').eq('id', body.song_id).maybeSingle());
    body.title = song?.title ?? 'Untitled song';
  }

  if (body.sort_order === undefined) {
    const last = await unwrap(
      req.db
        .from('plan_items')
        .select('sort_order')
        .eq('plan_id', plan.id)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    body.sort_order = (last?.sort_order ?? -1) + 1;
  }

  const created = await unwrapOne(
    req.db.from('plan_items').insert({ ...body, plan_id: plan.id }).select('*').single(),
  );
  res.status(201).json(created);
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
