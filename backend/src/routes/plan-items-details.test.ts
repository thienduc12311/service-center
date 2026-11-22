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

vi.mock('../services/delivery-worker.js', () => ({ deliverEffectNow: vi.fn(async () => undefined) }));

/**
 * Item details, service-time limits and carried song notes travel through the
 * existing item endpoints to `add_plan_item_with_details` /
 * `update_plan_item_with_details` (one transaction each). The fake records
 * what each RPC received and answers like the database would; the database
 * rules themselves are asserted in supabase/tests/plan-item-details.sql.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const PLAN = '00000000-0000-4000-8000-0000000000c1';
const ITEM = '00000000-0000-4000-8000-0000000000e1';
const SONG = '00000000-0000-4000-8000-0000000000f1';
const TIME = '00000000-0000-4000-8000-0000000000d1';
const REHEARSAL = '00000000-0000-4000-8000-0000000000d2';

/** One RPC call the fake received. */
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface RpcAnswer {
  data: unknown;
  error: { code: string; message: string; hint?: string } | null;
}

const state = vi.hoisted(() => ({ calls: [] as RpcCall[], replayed: false }));

const itemRow = (extra: Record<string, unknown> = {}) => ({
  id: ITEM,
  plan_id: PLAN,
  item_type: 'song',
  title: 'Amazing Grace',
  song_id: SONG,
  arrangement_id: null,
  key_override: null,
  length_seconds: 240,
  description: null,
  sort_order: 0,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service',
  details: null,
  item_times: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const timeIdsOf = (body: Record<string, unknown>): string[] => (Array.isArray(body.time_ids) ? (body.time_ids as string[]) : []);

const answer = (name: string, args: Record<string, unknown>): RpcAnswer => {
  if (name === 'add_plan_item_with_details') {
    const body = args.p_item as Record<string, unknown>;
    if (timeIdsOf(body).includes(REHEARSAL)) return { data: null, error: { code: '22023', message: 'Choose a service time of this plan' } };
    return {
      data: {
        item: itemRow({ details: body.details ?? null, item_times: timeIdsOf(body).map((id) => ({ plan_time_id: id })) }),
        content_revision: 8,
        replayed: state.replayed,
        carried_notes: body.carry_notes_from_last_use ? { count: 2, source_plan_id: 'plan-0', service_date: '2026-01-04T15:00:00Z' } : null,
      },
      error: null,
    };
  }
  if (name === 'update_plan_item_with_details') {
    const patch = args.p_patch as Record<string, unknown>;
    if (timeIdsOf(patch).includes(REHEARSAL)) return { data: null, error: { code: '22023', message: 'Choose a service time of this plan' } };
    return {
      data: { item: itemRow({ details: patch.details ?? null, item_times: timeIdsOf(patch).map((id) => ({ plan_time_id: id })) }), content_revision: 9 },
      error: null,
    };
  }
  if (name === 'song_last_use') {
    return args.p_song_id === SONG
      ? { data: { plan_id: 'plan-0', plan_title: 'Last week', service_date: '2026-01-04T15:00:00Z', item_id: 'item-0', note_count: 2 }, error: null }
      : { data: null, error: null };
  }
  return { data: null, error: { code: 'XX000', message: `unexpected ${name}` } };
};

const fakeDb = (): Db => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () =>
    Promise.resolve({ data: { id: PLAN, item_type: 'song', song_id: SONG, leader_person_id: null, leader_position_id: null }, error: null });
  return {
    from: () => chain,
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return Promise.resolve(answer(name, args));
    },
  } as unknown as Db;
};

const accessWith = (capability: 'plans.edit' | 'people.view_private' | null): EffectiveAccess => ({
  organization_id: ORG,
  user_id: 'user-1',
  role: capability === 'plans.edit' ? 'admin' : 'member',
  access_mode: 'scoped',
  can_administer_access: capability === 'plans.edit',
  entries: capability ? [{ capability, scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }] : [],
});

const makeApp = async (access: EffectiveAccess): Promise<Express> => {
  const { plansRouter } = await import('./plans.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
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

describe('plan item details, time limits and carried notes', () => {
  let editor: Express;
  let member: Express;

  beforeAll(async () => {
    editor = await makeApp(accessWith('plans.edit'));
    member = await makeApp(accessWith(null));
  });

  beforeEach(() => {
    state.calls = [];
    state.replayed = false;
  });

  it('saves details and the time list through the one revisioned edit', async () => {
    const res = await request(editor)
      .patch(`/api/v1/plans/${PLAN}/items/${ITEM}`)
      .send({ details: '## Cue\n- soft', time_ids: [TIME], expected_revision: 8 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ITEM, details: '## Cue\n- soft', item_times: [{ plan_time_id: TIME }], content_revision: 9 });
    expect(state.calls).toEqual([
      {
        name: 'update_plan_item_with_details',
        args: { p_plan_id: PLAN, p_item_id: ITEM, p_patch: { details: '## Cue\n- soft', time_ids: [TIME] }, p_expected_revision: 8 },
      },
    ]);
  });

  it('clears limits with an empty list and details with null', async () => {
    const res = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ details: null, time_ids: [] });
    expect(res.status).toBe(200);
    expect(state.calls[0]!.args.p_patch).toEqual({ details: null, time_ids: [] });
  });

  it('refuses details over 20,000 characters and malformed time ids before the database (422)', async () => {
    const long = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ details: 'x'.repeat(20_001) });
    const badTime = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ time_ids: ['9am'] });
    expect(long.status).toBe(422);
    expect(badTime.status).toBe(422);
    expect(state.calls).toEqual([]);
  });

  it('answers 400 when the database refuses a rehearsal (or another plan\'s) time', async () => {
    const res = await request(editor).patch(`/api/v1/plans/${PLAN}/items/${ITEM}`).send({ time_ids: [REHEARSAL] });
    expect(res.status).toBe(400);
  });

  it('adds a song carrying notes from its last use in the same request', async () => {
    const res = await request(editor)
      .post(`/api/v1/plans/${PLAN}/items`)
      .send({ item_type: 'song', song_id: SONG, carry_notes_from_last_use: true, time_ids: [TIME], idempotency_key: 'k-0000000001' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: ITEM,
      content_revision: 8,
      item_times: [{ plan_time_id: TIME }],
      carried_notes: { count: 2, source_plan_id: 'plan-0' },
    });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0]).toMatchObject({
      name: 'add_plan_item_with_details',
      args: {
        p_plan_id: PLAN,
        p_item: { item_type: 'song', song_id: SONG, carry_notes_from_last_use: true, time_ids: [TIME] },
        p_idempotency_key: 'k-0000000001',
      },
    });
    // The key travels separately; the body it guards includes the flag.
    expect(state.calls[0]!.args.p_item).not.toHaveProperty('idempotency_key');
  });

  it('answers a replayed add with 200 and no carried notes when none were asked for', async () => {
    state.replayed = true;
    const res = await request(editor).post(`/api/v1/plans/${PLAN}/items`).send({ item_type: 'item', title: 'Welcome', idempotency_key: 'k-0000000002' });
    expect(res.status).toBe(200);
    expect(res.body.carried_notes).toBeNull();
  });

  it('refuses a non-boolean carry flag', async () => {
    const res = await request(editor).post(`/api/v1/plans/${PLAN}/items`).send({ item_type: 'song', song_id: SONG, carry_notes_from_last_use: 'yes' });
    expect(res.status).toBe(422);
    expect(state.calls).toEqual([]);
  });

  it('previews the song\'s last use for plan editors only', async () => {
    const found = await request(editor).get(`/api/v1/plans/${PLAN}/songs/${SONG}/last-use`);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ plan_id: 'plan-0', note_count: 2, service_date: '2026-01-04T15:00:00Z' });

    const none = await request(editor).get(`/api/v1/plans/${PLAN}/songs/${TIME}/last-use`);
    expect(none.status).toBe(200);
    expect(none.body).toBeNull();

    const bad = await request(editor).get(`/api/v1/plans/${PLAN}/songs/not-a-uuid/last-use`);
    expect(bad.status).toBe(400);

    state.calls = [];
    const denied = await request(member).get(`/api/v1/plans/${PLAN}/songs/${SONG}/last-use`);
    expect(denied.status).toBe(403);
    expect(state.calls).toEqual([]);
  });
});
