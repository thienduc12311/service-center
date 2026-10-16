import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createPlanItemSchema,
  createPlanSchema,
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
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  PLAN_SUMMARY_SELECT,
  createPlanAtomically,
  duplicatePlanAtomically,
  fetchPlanDetail,
  importPlanContents,
  reorderPlanItems,
  setPlanPositionNeeds,
  shapePlanSummary,
} from '../services/plans.js';
import { notifyConfirmedAssignmentsForPlan } from './assignments.js';

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
plansRouter.post('/', requireManager, validateBody(createPlanSchema), async (req, res) => {
  const planId = await createPlanAtomically({
    db: req.db,
    orgId: req.orgId,
    input: req.body as CreatePlanInput,
  });
  res.status(201).json(await fetchPlanDetail(req.db, req.orgId, planId));
});

plansRouter.patch('/:id', requireManager, validateBody(updatePlanSchema), async (req, res) => {
  const { times, ...plan } = req.body as UpdatePlanInput;
  const existingPlan = await unwrapOne(req.db.from('plans').select('id, location, organization_id').eq('id', param(req, 'id')).eq('organization_id', req.orgId).single());
  const existingTimes = times
    ? (await unwrap(req.db.from('plan_times').select('id, starts_at, ends_at').eq('plan_id', param(req, 'id')).order('starts_at'))) ?? []
    : [];

  if (Object.keys(plan).length > 0) {
    const updated = await unwrap(
      req.db
        .from('plans')
        .update(plan)
        .eq('id', param(req, 'id'))
        .eq('organization_id', req.orgId)
        .select('id')
        .maybeSingle(),
    );
    if (!updated) throw HttpError.notFound('Plan not found');
  }

  // The editor sends the complete set; update by position so event UIDs remain stable.
  if (times) {
    for (const [index, time] of times.entries()) {
      const existing = existingTimes[index];
      if (existing) {
        await unwrap(req.db.from('plan_times').update(time).eq('id', existing.id).eq('plan_id', param(req, 'id')));
      } else {
        await unwrap(req.db.from('plan_times').insert({ ...time, plan_id: param(req, 'id') } as never));
      }
    }
    for (const stale of existingTimes.slice(times.length)) {
      await unwrap(req.db.from('plan_times').delete().eq('id', stale.id).eq('plan_id', param(req, 'id')));
    }
  }

  const timesChanged = times
    ? times.length !== existingTimes.length || times.some((time, index) => {
        const previous = existingTimes[index];
        return !previous || previous.starts_at !== time.starts_at || previous.ends_at !== time.ends_at;
      })
    : false;
  if (timesChanged || (plan.location !== undefined && plan.location !== existingPlan.location)) {
    await notifyConfirmedAssignmentsForPlan({ db: req.db, orgId: req.orgId, planId: existingPlan.id });
  }

  res.json(await fetchPlanDetail(req.db, req.orgId, param(req, 'id')));
});

plansRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('plans').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

/**
 * "Same as last week" — the single most-used action in a scheduling tool.
 * One transaction: order, times (shifted by the date change), needs and,
 * optionally, the team as fresh unconfirmed requests. Nobody is notified.
 */
plansRouter.post('/:id/duplicate', requireManager, validateBody(duplicatePlanSchema), async (req, res) => {
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
plansRouter.post('/:id/import', requireManager, validateBody(importPlanContentsSchema), async (req, res) => {
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
plansRouter.post('/:id/items', requireManager, validateBody(createPlanItemSchema), async (req, res) => {
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

plansRouter.patch('/:id/items/:itemId', requireManager, validateBody(updatePlanItemSchema), async (req, res) => {
  const updated = await unwrap(
    req.db
      .from('plan_items')
      .update(req.body)
      .eq('id', param(req, 'itemId'))
      .eq('plan_id', param(req, 'id'))
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Item not found');
  res.json(updated);
});

plansRouter.delete('/:id/items/:itemId', requireManager, async (req, res) => {
  await unwrap(
    req.db.from('plan_items').delete().eq('id', param(req, 'itemId')).eq('plan_id', param(req, 'id')),
  );
  res.status(204).end();
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

/** Persists a drag-and-drop reorder: the ids arrive in their new order. */
plansRouter.put('/:id/items/order', requireManager, validateBody(reorderPlanItemsSchema), async (req, res) => {
  const { item_ids } = req.body as { item_ids: string[] };

  res.json(await reorderPlanItems({ db: req.db, planId: param(req, 'id'), itemIds: item_ids }));
});
