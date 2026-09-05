import { Router } from 'express';
import { param } from '../lib/params.js';
import { blockoutSchema } from '@service-center/shared';
import { z } from 'zod';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { canManage } from '@service-center/shared';

export const blockoutsRouter: Router = Router();

const listQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Managers can ask for everyone's; members always see only their own. */
  scope: z.enum(['mine', 'organization']).default('mine'),
});

blockoutsRouter.get('/', validateQuery(listQuerySchema), async (req, res) => {
  const { user_id, from, to, scope } = parsedQuery<z.infer<typeof listQuerySchema>>(res);

  let query = raw(req.db)
    .from('blockouts')
    .select('*, person:profiles(id, full_name, email, avatar_url)')
    .eq('organization_id', req.orgId)
    .order('starts_at');

  if (scope === 'organization') {
    if (!canManage(req.orgRole)) throw HttpError.forbidden('Only schedulers can see everyone’s blockouts');
    if (user_id) query = query.eq('user_id', user_id);
  } else {
    query = query.eq('user_id', req.auth.userId);
  }

  if (from) query = query.gte('ends_at', from);
  if (to) query = query.lte('starts_at', to);

  res.json((await unwrap(query)) ?? []);
});

blockoutsRouter.post('/', validateBody(blockoutSchema), async (req, res) => {
  const { user_id, ...blockout } = req.body as { user_id?: string } & Record<string, unknown>;

  // RLS only lets you insert your own; recording someone else's needs a manager
  // role, and is rejected here with a clearer message than a 403 from Postgres.
  const targetUserId = user_id ?? req.auth.userId;
  if (targetUserId !== req.auth.userId && !canManage(req.orgRole)) {
    throw HttpError.forbidden('Only schedulers can record blockouts for other people');
  }

  const created = await unwrapOne(
    req.db
      .from('blockouts')
      .insert({ ...blockout, organization_id: req.orgId, user_id: targetUserId })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

blockoutsRouter.delete('/:id', async (req, res) => {
  const blockout = await unwrap(
    req.db.from('blockouts').select('id, user_id').eq('id', param(req, 'id')).maybeSingle(),
  );
  if (!blockout) throw HttpError.notFound('Blockout not found');
  if (blockout.user_id !== req.auth.userId && !canManage(req.orgRole)) {
    throw HttpError.forbidden('You can only remove your own blockouts');
  }

  await unwrap(req.db.from('blockouts').delete().eq('id', param(req, 'id')));
  res.status(204).end();
});
