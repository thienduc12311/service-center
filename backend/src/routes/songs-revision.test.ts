import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * MOB-028 / F15: the revision contract of `PATCH /songs/:id` and
 * `PATCH /arrangements/:id` (`updateSong`, `updateArrangement`), which both
 * clients now send. The database is a fake that bumps `revision` on every
 * update like the `bump_library_revision` trigger; RLS and the real trigger
 * are exercised against local Postgres in the MOB-028 ledger entry.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const SONG = '00000000-0000-4000-8000-0000000000a1';
const ARRANGEMENT = '00000000-0000-4000-8000-0000000000b1';

interface StoredRow {
  id: string;
  organization_id?: string;
  revision: number;
  [column: string]: unknown;
}

interface FakeState {
  tables: Record<'songs' | 'arrangements', StoredRow[]>;
  writes: { table: string; values: Record<string, unknown>; filters: Record<string, unknown> }[];
}

type Filters = Record<string, unknown>;

const matches = (row: StoredRow, filters: Filters): boolean =>
  Object.entries(filters).every(([column, value]) => row[column] === value);

const fakeDb = (state: FakeState): Db => {
  const from = (table: 'songs' | 'arrangements') => {
    const rows = state.tables[table];
    const reader = (filters: Filters) => ({
      eq: (column: string, value: unknown) => reader({ ...filters, [column]: value }),
      maybeSingle: () => {
        const row = rows.find((candidate) => matches(candidate, filters));
        return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
      },
    });
    const updater = (values: Record<string, unknown>, filters: Filters) => ({
      eq: (column: string, value: unknown) => updater(values, { ...filters, [column]: value }),
      select: () => ({
        maybeSingle: () => {
          state.writes.push({ table, values, filters });
          const row = rows.find((candidate) => matches(candidate, filters));
          if (!row) return Promise.resolve({ data: null, error: null });
          Object.assign(row, values, { revision: row.revision + 1 });
          return Promise.resolve({ data: { ...row }, error: null });
        },
      }),
    });
    return {
      select: () => reader({}),
      update: (values: Record<string, unknown>) => updater(values, {}),
    };
  };
  return { from } as unknown as Db;
};

const managerAccess: EffectiveAccess = {
  organization_id: ORG,
  user_id: 'user-1',
  role: 'admin',
  access_mode: 'scoped',
  can_administer_access: true,
  entries: [{ capability: 'songs.manage', scope_type: 'organization', scope_id: null, source: 'role:admin', grant_id: null }],
};

describe('revisioned song and arrangement edits', () => {
  let state: FakeState;
  let access: EffectiveAccess;
  let app: Express;

  beforeAll(async () => {
    const { songsRouter, arrangementsRouter } = await import('./songs.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: 'user-1', email: 'sam@example.test', accessToken: 'token' };
      req.db = fakeDb(state);
      req.orgId = ORG;
      req.access = access;
      next();
    });
    app.use('/api/v1/songs', songsRouter);
    app.use('/api/v1/arrangements', arrangementsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    access = managerAccess;
    state = {
      tables: {
        songs: [{ id: SONG, organization_id: ORG, title: 'Amazing Grace', revision: 4 }],
        arrangements: [{ id: ARRANGEMENT, song_id: SONG, name: 'Band', song_key: 'G', revision: 2 }],
      },
      writes: [],
    };
  });

  it('saves a song edit made at the current revision and returns the next revision', async () => {
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ title: 'Amazing Grace (My Chains)', expected_revision: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Amazing Grace (My Chains)', revision: 5 });
    // The revision is a condition of the write, never a column it sets.
    expect(state.writes[0]?.values).toEqual({ title: 'Amazing Grace (My Chains)' });
    expect(state.writes[0]?.filters).toMatchObject({ id: SONG, organization_id: ORG, revision: 4 });
  });

  it('refuses a stale song edit with 409 song_revision_stale and changes nothing', async () => {
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ title: 'Older draft', expected_revision: 3 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('song_revision_stale');
    expect(state.tables.songs[0]).toMatchObject({ title: 'Amazing Grace', revision: 4 });
  });

  it('keeps the legacy last-write-wins contract when no revision is sent', async () => {
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ notes: 'Capo 2 on the acoustic' });
    expect(res.status).toBe(200);
    expect(state.writes[0]?.filters).not.toHaveProperty('revision');
  });

  it('answers 404, not 409, when the song is not visible', async () => {
    state.tables.songs = [];
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ title: 'Anything', expected_revision: 4 });
    expect(res.status).toBe(404);
  });

  it('rejects a non-positive revision before writing', async () => {
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ title: 'Anything', expected_revision: 0 });
    expect(res.status).toBe(422);
    expect(state.writes).toEqual([]);
  });

  it('applies the same contract to arrangements', async () => {
    const stale = await request(app).patch(`/api/v1/arrangements/${ARRANGEMENT}`).send({ song_key: 'A', expected_revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('arrangement_revision_stale');
    expect(state.tables.arrangements[0]).toMatchObject({ song_key: 'G', revision: 2 });

    const saved = await request(app).patch(`/api/v1/arrangements/${ARRANGEMENT}`).send({ song_key: 'A', expected_revision: 2 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ song_key: 'A', revision: 3 });

    // The edit that just landed made the earlier revision stale for anyone still holding it.
    const again = await request(app).patch(`/api/v1/arrangements/${ARRANGEMENT}`).send({ song_key: 'B', expected_revision: 2 });
    expect(again.status).toBe(409);
  });

  it('requires songs.manage', async () => {
    access = { ...managerAccess, role: 'member', entries: [] };
    const res = await request(app).patch(`/api/v1/songs/${SONG}`).send({ title: 'Anything', expected_revision: 4 });
    expect(res.status).toBe(403);
    expect(state.writes).toEqual([]);
  });
});
