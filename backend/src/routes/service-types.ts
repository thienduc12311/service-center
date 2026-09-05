import { Router } from 'express';
import { param } from '../lib/params.js';
import { serviceTypeSchema } from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';

export const serviceTypesRouter: Router = Router();

serviceTypesRouter.get('/', async (req, res) => {
  const rows = await unwrap(
    req.db
      .from('service_types')
      .select('*')
      .eq('organization_id', req.orgId)
      .order('sort_order')
      .order('name'),
  );
  res.json(rows ?? []);
});

serviceTypesRouter.post('/', requireManager, validateBody(serviceTypeSchema), async (req, res) => {
  const created = await unwrapOne(
    req.db
      .from('service_types')
      .insert({ ...req.body, organization_id: req.orgId })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

serviceTypesRouter.patch('/:id', requireManager, validateBody(serviceTypeSchema.partial()), async (req, res) => {
  const updated = await unwrapOne(
    req.db
      .from('service_types')
      .update(req.body)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .single(),
  );
  res.json(updated);
});

serviceTypesRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(
    req.db.from('service_types').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId),
  );
  res.status(204).end();
});
