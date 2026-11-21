import { Router } from 'express';
import type { RealtimeTopicKey } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { unwrap } from '../lib/supabase.js';

/**
 * `/api/v1/realtime`: the secret that private Realtime topic names carry. The database function
 * returns it only to an active member and the key rotates when a member is removed, so a removed
 * member cannot learn the topics that are used after the removal.
 */
export const realtimeRouter: Router = Router();

realtimeRouter.get('/key', async (req, res) => {
  const key = await unwrap(req.db.rpc('realtime_topic_key', { p_org: req.orgId }));
  if (!key) throw HttpError.notFound();
  // A key must never be kept by a shared cache or across sign-out.
  res.set('Cache-Control', 'no-store');
  const body: RealtimeTopicKey = { key };
  res.json(body);
});
