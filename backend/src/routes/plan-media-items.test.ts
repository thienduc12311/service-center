import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { EffectiveAccess } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * Media as its own order item type: what the item routes send to the
 * database and what they refuse before it. The constraint, the default title
 * and RLS themselves are asserted in supabase/tests/media-item-type.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';
const ITEM = '00000000-0000-4000-8000-0000000000e1';
const MEDIA = '00000000-0000-4000-8000-0000000000aa';

/** The item fields the update path reads before writing. */
interface CurrentItem {
  item_type: 'song' | 'header' | 'item' | 'media';
  song_id: string | null;
  leader_person_id: string | null;
  leader_position_id: string | null;
  media_id: string | null;
}

/** One RPC call the fake database saw. */
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const store = vi.hoisted(() => ({ calls: [] as RpcCall[], current: null as CurrentItem | null }));

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  let table = '';
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () =>
    Promise.resolve({ data: table === 'plans' ? { id: PLAN } : structuredClone(store.current), error: null });
  return {
    from: (name: string) => {
      table = name;
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      store.calls.push({ name, args });
      const body = (args.p_item ?? args.p_patch) as Record<string, unknown>;
      const item = { id: ITEM, plan_id: PLAN, ...body, title: body.title ?? 'Countdown video' };
      return Promise.resolve({ data: { item, content_revision: 8, replayed: false }, error: null });
    },
  } as unknown as Db;
};

const editorAccess: EffectiveAccess = {
  organization_id: ORG,
  user_id: 'user-1',
  role: 'admin',
  access_mode: 'scoped',
  can_administer_access: true,
  entries: [{ capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }],
};

const memberAccess: EffectiveAccess = { ...editorAccess, role: 'member', can_administer_access: false, entries: [] };

const appFor = async (access: EffectiveAccess): Promise<Express> => {
  const { plansRouter } = await import('./plans.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
    req.db = fakeDb();
    req.orgId = ORG;
    req.access = access;
    next();
  });
  app.use('/api/v1/plans', plansRouter);
  app.use(errorHandler);
  return app;
};

describe('media items', () => {
  let editor: Express;
  let member: Express;

  beforeAll(async () => {
    editor = await appFor(editorAccess);
    member = await appFor(memberAccess);
  });

  beforeEach(() => {
    store.calls = [];
    store.current = null;
  });

  it('creates a media item from its media, leaving the title to the bundle', async () => {
    const res = await request(editor)
      .post(`/api/v1/plans/${PLAN}/items`)
      .send({ item_type: 'media', media_id: MEDIA, length_seconds: 300 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ item_type: 'media', media_id: MEDIA, title: 'Countdown video', content_revision: 8 });
    expect(store.calls).toEqual([
      { name: 'add_plan_item_with_details', args: expect.objectContaining({ p_item: expect.objectContaining({ item_type: 'media', media_id: MEDIA, length_seconds: 300 }) }) },
    ]);
  });

  it('refuses a media item without media before writing', async () => {
    const res = await request(editor).post(`/api/v1/plans/${PLAN}/items`).send({ item_type: 'media', title: 'Video' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('media_id');
    expect(store.calls).toEqual([]);
  });

  it('refuses a malformed media id', async () => {
    const res = await request(editor).post(`/api/v1/plans/${PLAN}/items`).send({ item_type: 'media', media_id: 'nope' });
    expect(res.status).toBe(422);
    expect(store.calls).toEqual([]);
  });

  it('does not let a non-editor add one', async () => {
    const res = await request(member).post(`/api/v1/plans/${PLAN}/items`).send({ item_type: 'media', media_id: MEDIA });
    expect(res.status).toBe(403);
    expect(store.calls).toEqual([]);
  });

  it('turns an item into a media item only when it already has media', async () => {
    store.current = { item_type: 'item', song_id: null, leader_person_id: null, leader_position_id: null, media_id: null };
    const refused = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ item_type: 'media' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('media_item_needs_media');
    expect(store.calls).toEqual([]);

    store.current = { ...store.current, media_id: MEDIA };
    const ok = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ item_type: 'media' });
    expect(ok.status).toBe(200);
    expect(store.calls[0]).toMatchObject({ name: 'update_plan_item_with_details', args: { p_patch: { item_type: 'media', song_id: null } } });
  });
});
