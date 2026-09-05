import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createPlanItemSchema,
  createPlanSchema,
  listPlansQuerySchema,
  reorderPlanItemsSchema,
  updatePlanItemSchema,
  updatePlanSchema,
  type CreatePlanInput,
  type ListPlansQuery,
  type Paginated,
  type PlanSummary,
  type UpdatePlanInput,
} from '@service-center/shared';
import { z } from 'zod';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  PLAN_SUMMARY_SELECT,
  copyPlanContents,
  fetchPlanDetail,
  reorderPlanItems,
  shapePlanSummary,
} from '../services/plans.js';

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

plansRouter.post('/', requireManager, validateBody(createPlanSchema), async (req, res) => {
  const { times, copy_from_plan_id, copy_assignments, ...plan } = req.body as CreatePlanInput;

  const created = await unwrapOne(
    req.db
      .from('plans')
      .insert({ ...plan, organization_id: req.orgId, created_by: req.auth.userId })
      .select('*')
      .single(),
  );

  if (times.length) {
    await unwrap(
      req.db.from('plan_times').insert(times.map((t) => ({ ...t, plan_id: created.id })) as never),
    );
  }

  if (copy_from_plan_id) {
    await copyPlanContents({
      db: req.db,
      sourcePlanId: copy_from_plan_id,
      targetPlanId: created.id,
      createdBy: req.auth.userId,
      withAssignments: copy_assignments,
    });
  }

  res.status(201).json(await fetchPlanDetail(req.db, req.orgId, created.id));
});

plansRouter.patch('/:id', requireManager, validateBody(updatePlanSchema), async (req, res) => {
  const { times, ...plan } = req.body as UpdatePlanInput;

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

  // Times are replaced wholesale — the editor always sends the complete set.
  if (times) {
    await unwrap(req.db.from('plan_times').delete().eq('plan_id', param(req, 'id')));
    if (times.length) {
      await unwrap(
        req.db.from('plan_times').insert(times.map((t) => ({ ...t, plan_id: param(req, 'id') })) as never),
      );
    }
  }

  res.json(await fetchPlanDetail(req.db, req.orgId, param(req, 'id')));
});

plansRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('plans').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

const duplicateSchema = z.object({
  service_date: z.string(),
  title: z.string().trim().min(1).max(200).optional(),
  copy_assignments: z.boolean().default(true),
});

/** "Same as last week" — the single most-used action in a scheduling tool. */
plansRouter.post('/:id/duplicate', requireManager, validateBody(duplicateSchema), async (req, res) => {
  const { service_date, title, copy_assignments } = req.body as z.infer<typeof duplicateSchema>;

  const source = await fetchPlanDetail(req.db, req.orgId, param(req, 'id'));
  const offsetMs = new Date(service_date).getTime() - new Date(source.service_date).getTime();

  const created = await unwrapOne(
    req.db
      .from('plans')
      .insert({
        organization_id: req.orgId,
        service_type_id: source.service_type_id,
        title: title ?? source.title,
        service_date,
        location: source.location,
        status: 'draft',
        notes: source.notes,
        created_by: req.auth.userId,
      })
      .select('*')
      .single(),
  );

  // Shift every rehearsal/service time by the same delta as the service date,
  // so a plan moved a week later keeps its Friday rehearsal.
  if (source.times.length) {
    await unwrap(
      req.db.from('plan_times').insert(
        source.times.map((t) => ({
          plan_id: created.id,
          kind: t.kind,
          name: t.name,
          starts_at: new Date(new Date(t.starts_at).getTime() + offsetMs).toISOString(),
          ends_at: new Date(new Date(t.ends_at).getTime() + offsetMs).toISOString(),
        })),
      ),
    );
  }

  await copyPlanContents({
    db: req.db,
    sourcePlanId: source.id,
    targetPlanId: created.id,
    createdBy: req.auth.userId,
    withAssignments: copy_assignments,
  });
  res.status(201).json(await fetchPlanDetail(req.db, req.orgId, created.id));
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

/** Persists a drag-and-drop reorder: the ids arrive in their new order. */
plansRouter.put('/:id/items/order', requireManager, validateBody(reorderPlanItemsSchema), async (req, res) => {
  const { item_ids } = req.body as { item_ids: string[] };

  res.json(await reorderPlanItems({ db: req.db, planId: param(req, 'id'), itemIds: item_ids }));
});
