import { Router } from 'express';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
  registerDeviceSchema,
  type ListNotificationsQuery,
  type MarkNotificationsReadInput,
  type NotificationFeed,
  type NotificationFeedItem,
  type RegisterDeviceInput,
  type UnreadNotificationCount,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { adminDb, raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';

export const notificationsRouter: Router = Router();
export const devicesRouter: Router = Router();

/** Unread across the whole organization — what the bell's badge shows. */
const unreadCountFor = async (db: Db, orgId: string, userId: string): Promise<number> => {
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
};

// ------------------------------------------------------------- the feed ----
notificationsRouter.get('/', validateQuery(listNotificationsQuerySchema), async (req, res) => {
  const { limit, before, unread_only } = parsedQuery<ListNotificationsQuery>(res);

  let query = raw(req.db)
    .from('notifications')
    .select('*, plan:plans(id, title, service_date)')
    .eq('organization_id', req.orgId)
    .eq('user_id', req.auth.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Keyset rather than offset: the feed only ever pages backwards in time.
  if (before) query = query.lt('created_at', before);
  if (unread_only) query = query.is('read_at', null);

  const items = ((await unwrap(query)) ?? []) as unknown as NotificationFeedItem[];
  const feed: NotificationFeed = {
    items,
    unread: await unreadCountFor(req.db, req.orgId, req.auth.userId),
    next_cursor: items.length === limit ? (items[items.length - 1]?.created_at ?? null) : null,
  };
  res.json(feed);
});

notificationsRouter.get('/unread-count', async (req, res) => {
  const body: UnreadNotificationCount = {
    unread: await unreadCountFor(req.db, req.orgId, req.auth.userId),
  };
  res.json(body);
});

/** Marks the given notifications read, or the whole feed when `ids` is omitted. */
notificationsRouter.post('/read', validateBody(markNotificationsReadSchema), async (req, res) => {
  const { ids } = req.body as MarkNotificationsReadInput;

  // RLS already limits this to the caller's own rows; the filters keep it
  // scoped to the active organization as well.
  let update = req.db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('organization_id', req.orgId)
    .eq('user_id', req.auth.userId)
    .is('read_at', null);
  if (ids?.length) update = update.in('id', ids);

  await unwrap(update);
  const body: UnreadNotificationCount = {
    unread: await unreadCountFor(req.db, req.orgId, req.auth.userId),
  };
  res.json(body);
});

notificationsRouter.delete('/:id', async (req, res) => {
  await unwrap(
    req.db
      .from('notifications')
      .delete()
      .eq('id', param(req, 'id'))
      .eq('user_id', req.auth.userId),
  );
  res.status(204).end();
});

// ------------------------------------------------------- device registry ----
/**
 * Registers this device's Expo push token. Not organization-scoped: a device
 * belongs to the person, across every organization they are a member of.
 *
 * Written with the service role because an Expo token is globally unique — a
 * phone handed to someone else, or an app reinstall, must move the row to the
 * new owner, which RLS (rightly) would not allow the new owner to do.
 */
devicesRouter.post('/', validateBody(registerDeviceSchema), async (req, res) => {
  const { token, platform, device_name } = req.body as RegisterDeviceInput;
  const device = await unwrapOne(
    adminDb
      .from('device_push_tokens')
      .upsert(
        {
          user_id: req.auth.userId,
          token,
          platform,
          device_name: device_name ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      )
      .select('*')
      .single(),
  );
  res.status(201).json(device);
});

devicesRouter.delete('/:token', async (req, res) => {
  await unwrap(
    req.db.from('device_push_tokens').delete().eq('token', param(req, 'token')),
  );
  res.status(204).end();
});
