import { Router } from 'express';
import {
  commitStaffingMatrixSchema,
  previewStaffingMatrixSchema,
  saveStaffingMatrixViewSchema,
  staffingMatrixQuerySchema,
  staffingMatrixFiltersSchema,
  type CommitStaffingMatrixInput,
  type PreviewStaffingMatrixInput,
  type SaveStaffingMatrixViewInput,
  type StaffingMatrixCommitResult,
  type StaffingMatrixSavedView,
  type StaffingMatrixViewRow,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { fromPostgrestError } from '../lib/errors.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { validateBody } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { deliverEffectNow } from '../services/delivery-worker.js';
import { loadStaffingMatrix, previewStaffingMatrix, sanitizeMatrixFilters } from '../services/staffing-matrix.js';

export const staffingMatrixRouter: Router = Router();
staffingMatrixRouter.use(requireCapability('scheduling.manage'));

staffingMatrixRouter.post('/query', validateBody(staffingMatrixQuerySchema), async (req, res) => {
  res.json(await loadStaffingMatrix(req, req.body));
});

staffingMatrixRouter.post('/preview', validateBody(previewStaffingMatrixSchema), async (req, res) => {
  const { actions } = req.body as PreviewStaffingMatrixInput;
  res.json(await previewStaffingMatrix(req, actions));
});

staffingMatrixRouter.post('/commit', validateBody(commitStaffingMatrixSchema), async (req, res) => {
  const input = req.body as CommitStaffingMatrixInput;
  const { data, error } = await raw(req.db).rpc('commit_staffing_matrix', {
    p_organization_id: req.orgId,
    p_operation_id: input.operation_id,
    p_actions: input.actions,
    p_base_revisions: input.base_revisions,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  const result = data as StaffingMatrixCommitResult;
  for (const effectId of result.delivery_effect_ids) await deliverEffectNow(effectId);
  res.json(result);
});

staffingMatrixRouter.get('/views', async (req, res) => {
  const rows = ((await unwrap(req.db.from('staffing_matrix_views').select('*')
    .eq('organization_id', req.orgId).eq('owner_id', req.auth.userId).order('name'))) ?? []) as StaffingMatrixViewRow[];
  const views: StaffingMatrixSavedView[] = [];
  for (const row of rows) {
    const parsed = staffingMatrixFiltersSchema.safeParse(row.filters);
    if (!parsed.success) continue;
    views.push({ id: row.id, name: row.name, filters: await sanitizeMatrixFilters(req, parsed.data),
      created_at: row.created_at, updated_at: row.updated_at });
  }
  res.json(views);
});

staffingMatrixRouter.post('/views', validateBody(saveStaffingMatrixViewSchema), async (req, res) => {
  const input = req.body as SaveStaffingMatrixViewInput;
  const filters = await sanitizeMatrixFilters(req, input.filters);
  const row = await unwrapOne(raw(req.db).from('staffing_matrix_views').upsert({
    organization_id: req.orgId, owner_id: req.auth.userId, name: input.name, filters,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,owner_id,name' }).select('*').single());
  res.status(201).json(row);
});

staffingMatrixRouter.delete('/views/:viewId', async (req, res) => {
  await unwrap(req.db.from('staffing_matrix_views').delete().eq('id', param(req, 'viewId'))
    .eq('organization_id', req.orgId).eq('owner_id', req.auth.userId));
  res.status(204).end();
});
