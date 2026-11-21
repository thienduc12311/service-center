import { Router } from 'express';
import {
  realtimeResourceTopicsSchema,
  type RealtimeResourceTopicRow,
  type RealtimeResourceTopics,
  type RealtimeResourceTopicsInput,
  type RealtimeTopicKey,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { unwrap } from '../lib/supabase.js';
import { validateBody } from '../lib/validate.js';

/**
 * `/api/v1/realtime`: the secrets that private Realtime topic names carry. The database returns
 * them only to an active member (the organization key) or a person who can use the resource right
 * now (a conversation topic). Keys rotate when that access is lost, so a person who lost it cannot
 * learn the topics that are used afterwards.
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

const mapTopicRows = (rows: readonly RealtimeResourceTopicRow[]): RealtimeResourceTopics => ({
  topics: Object.fromEntries(rows.map((row) => [row.resource_id, row.topic])),
});

/**
 * Access is decided per resource on every request, by the database. A resource the caller cannot
 * use is simply left out of the answer, so a removed teammate sees nothing about the conversation.
 * A non-member gets an empty answer from the database; the organization key route above is where
 * revocation is signalled with 404.
 */
realtimeRouter.post('/topics', validateBody(realtimeResourceTopicsSchema), async (req, res) => {
  const input: RealtimeResourceTopicsInput = req.body;
  const rows = await unwrap(req.db.rpc('realtime_resource_topics', {
    p_org: req.orgId,
    p_resource: input.resource,
    p_ids: input.ids,
  }));
  res.set('Cache-Control', 'no-store');
  res.json(mapTopicRows(rows ?? []));
});
