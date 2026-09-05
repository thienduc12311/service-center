import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { isAdmin } from '@service-center/shared';

export const organizationsRouter: Router = Router();

organizationsRouter.get('/', async (req, res) => {
  const rows = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, organization:organizations(*)')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active'),
  )) as Array<{ role: string; organization: unknown }>;

  res.json(rows.filter((r) => r.organization).map((r) => ({ organization: r.organization, role: r.role })));
});

/**
 * Creating an organization and joining it as owner happens inside a single
 * SECURITY DEFINER function, otherwise RLS would hide the row from its creator.
 */
organizationsRouter.post('/', validateBody(createOrganizationSchema), async (req, res) => {
  const { name, slug, timezone } = req.body;
  const { data, error } = await raw(req.db).rpc('create_organization', {
    p_name: name,
    p_slug: slug,
    p_timezone: timezone,
  });

  if (error) {
    if (error.code === '23505') throw HttpError.conflict('That URL slug is already taken');
    throw new HttpError(500, error.message, error.code);
  }
  res.status(201).json(data);
});

organizationsRouter.patch('/:id', validateBody(updateOrganizationSchema), async (req, res) => {
  const membership = await unwrap(
    req.db
      .from('organization_members')
      .select('role')
      .eq('organization_id', param(req, 'id'))
      .eq('user_id', req.auth.userId)
      .maybeSingle(),
  );
  if (!membership || !isAdmin(membership.role)) {
    throw HttpError.forbidden('Only organization admins can change settings');
  }

  const updated = await unwrapOne(
    req.db.from('organizations').update(req.body).eq('id', param(req, 'id')).select('*').single(),
  );
  res.json(updated);
});
