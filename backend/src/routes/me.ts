import { Router } from 'express';
import { updateProfileSchema, type CurrentUser } from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export const meRouter: Router = Router();

/** The signed-in profile plus every organization the user belongs to. */
meRouter.get('/', async (req, res) => {
  const profile = await unwrapOne(
    req.db.from('profiles').select('*').eq('id', req.auth.userId).single(),
  );

  const memberships = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, organization:organizations(*)')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active'),
  )) as Array<{ role: string; organization: unknown }>;

  const payload: CurrentUser = {
    profile,
    memberships: memberships
      .filter((m) => m.organization)
      .map((m) => ({ organization: m.organization, role: m.role })) as CurrentUser['memberships'],
  };

  res.json(payload);
});

meRouter.patch('/', validateBody(updateProfileSchema), async (req, res) => {
  const updated = await unwrapOne(
    req.db.from('profiles').update(req.body).eq('id', req.auth.userId).select('*').single(),
  );
  if (!updated) throw HttpError.notFound('Profile not found');
  res.json(updated);
});
