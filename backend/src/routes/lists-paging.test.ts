import { describe, expect, it } from 'vitest';
import express, { type Express, type Router } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';
import { pagedDb, uuid, type FakeLog, type FakeRow } from './paged-fake.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

const COUNT = 1101;
/** The songbook schema accepts at most 500 songs. */
const SONGBOOK_SONGS = 450;
const rowsOf = (make: (index: number) => FakeRow): FakeRow[] => Array.from({ length: COUNT }, (_, index) => make(index));

const mount = async (path: string, load: () => Promise<Router>, db: Db): Promise<Express> => {
  const { errorHandler } = await import('../middleware/error-handler.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 'org';
    req.orgRole = 'owner';
    req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
    req.access = { organization_id: 'org', user_id: 'self', role: 'owner', access_mode: 'legacy', can_administer_access: true, entries: [{ capability: 'songs.manage', scope_type: 'organization', scope_id: null, source: 'role:owner', grant_id: null }] };
    req.db = db;
    next();
  });
  app.use(path, await load());
  app.use(errorHandler);
  return app;
};

const ids = (body: unknown): string[] => (body as Array<{ id: string }>).map((row) => row.id);

describe('GET /teams past the 1000-row cap (W8-PERF-D2)', () => {
  it('returns every team', async () => {
    const db = pagedDb({
      teams: rowsOf((i) => ({ id: uuid(i), organization_id: 'org', sort_order: i, positions: [] })),
      organization_members: rowsOf((i) => ({ user_id: uuid(i), role: 'member' })),
    });
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, db);
    const response = await request(app).get('/teams');
    expect(response.status).toBe(200);
    expect(new Set(ids(response.body)).size).toBe(COUNT);
  });

  it('resolves the role of an org member past row 1000', async () => {
    const db = pagedDb(
      {
        teams: [{ id: 't1', organization_id: 'org', sort_order: 0, positions: [] }],
        team_memberships: [{ id: 'm1', team_id: 't1', person_id: 'p1', user_id: uuid(COUNT - 1), position_id: null }],
        organization_members: rowsOf((i) => ({ user_id: uuid(i), role: i === COUNT - 1 ? 'admin' : 'member' })),
      },
      [],
      { team_roster_people: [{ team_id: 't1', person_id: 'p1', first_name: 'Ada', last_name: 'L', avatar_url: null, email: null, phone: null, birthdate: null }] },
    );
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, db);
    const response = await request(app).get('/teams');
    const [team] = response.body as Array<{ members: Array<{ profile: { role: string } | null }> }>;
    expect(team?.members[0]?.profile?.role).toBe('admin');
  });

  it('names a teammate whose roster row is past row 1000 of team_roster_people', async () => {
    const memberships = rowsOf((i) => ({ id: `m${i}`, team_id: 't1', person_id: uuid(i), user_id: null, position_id: null }));
    const roster = rowsOf((i) => ({
      team_id: 't1', person_id: uuid(i), first_name: `P${i}`, last_name: null, avatar_url: null, email: null, phone: null, birthdate: null,
    }));
    const log: FakeLog = { inCalls: [], rpcCalls: [] };
    const db = pagedDb(
      { teams: [{ id: 't1', organization_id: 'org', sort_order: 0, positions: [] }], team_memberships: memberships, organization_members: [] },
      log.inCalls,
      { team_roster_people: roster },
      log,
    );
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, db);
    const response = await request(app).get('/teams');
    expect(response.status).toBe(200);
    const [team] = response.body as Array<{ members: Array<{ person_id: string; profile: { full_name: string } | null }> }>;
    expect(team?.members).toHaveLength(COUNT);
    expect(team?.members.every((member) => member.profile !== null)).toBe(true);
    expect(team?.members.at(-1)?.profile?.full_name).toBe(`P${COUNT - 1}`);
    const rosterCalls = log.rpcCalls.filter((call) => call.fn === 'team_roster_people');
    expect(rosterCalls.length).toBeGreaterThan(1);
    expect(rosterCalls[0]?.order).toEqual(['team_id', 'person_id']);
  });

  it('loads one team without the whole organization roster or role map', async () => {
    const TEAM = uuid(9001);
    const log: FakeLog = { inCalls: [], rpcCalls: [] };
    const db = pagedDb(
      {
        teams: [{ id: TEAM, organization_id: 'org', sort_order: 0, positions: [] }],
        team_memberships: [{ id: 'm1', team_id: TEAM, person_id: 'p1', user_id: 'u1', position_id: null }],
        organization_members: [{ user_id: 'u1', role: 'scheduler' }, ...rowsOf((i) => ({ user_id: uuid(i), role: 'member' }))],
      },
      log.inCalls,
      {
        team_roster_people: [
          { team_id: 't2', person_id: 'p9', first_name: 'Other', last_name: null, avatar_url: null, email: null, phone: null, birthdate: null },
          { team_id: TEAM, person_id: 'p1', first_name: 'Ada', last_name: null, avatar_url: null, email: null, phone: null, birthdate: null },
        ],
      },
      log,
    );
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, db);
    const response = await request(app).get(`/teams/${TEAM}`);
    expect(response.status).toBe(200);
    const team = response.body as { members: Array<{ profile: { full_name: string; role: string } | null }> };
    expect(team.members[0]?.profile).toMatchObject({ full_name: 'Ada', role: 'scheduler' });
    expect(log.rpcCalls[0]?.eq).toEqual([['team_id', TEAM]]);
    expect(log.inCalls).toEqual([['u1']]);
  });
});

describe('team members past the 1000-row cap (W9-DATA-D1)', () => {
  const TEAM = uuid(9002);
  const bigTeam = (): Db => {
    const memberships = rowsOf((i) => ({ id: uuid(i), team_id: TEAM, person_id: uuid(i), user_id: null, position_id: null }));
    const roster = rowsOf((i) => ({
      team_id: TEAM, person_id: uuid(i), first_name: `P${i}`, last_name: null, avatar_url: null, email: null, phone: null, birthdate: null,
    }));
    return pagedDb(
      { teams: [{ id: TEAM, organization_id: 'org', sort_order: 0, positions: [] }], team_memberships: memberships, organization_members: [] },
      [],
      { team_roster_people: roster },
    );
  };

  it('GET /teams returns all 1,101 members of one team', async () => {
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, bigTeam());
    const response = await request(app).get('/teams');
    expect(response.status).toBe(200);
    const [team] = response.body as Array<{ members: Array<{ membership_id: string }> }>;
    expect(new Set(team?.members.map((member) => member.membership_id)).size).toBe(COUNT);
  });

  it('GET /teams/:id returns all 1,101 members', async () => {
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, bigTeam());
    const response = await request(app).get(`/teams/${TEAM}`);
    expect(response.status).toBe(200);
    const team = response.body as { members: Array<{ membership_id: string; profile: { full_name: string } | null }> };
    expect(new Set(team.members.map((member) => member.membership_id)).size).toBe(COUNT);
    expect(team.members.at(-1)?.profile?.full_name).toBe(`P${COUNT - 1}`);
  });
});

describe('scope access with hundreds of grantees (W9-DATA-D2)', () => {
  const grantees = (count: number, inCalls: string[][] = []): Db => pagedDb({
    access_grants: rowsOf((i) => ({
      id: uuid(i), organization_id: 'org', user_id: uuid(i), capability: 'teams.manage', scope_type: 'team', team_id: 't1', created_at: '2026-11-21T00:00:00Z',
    })).slice(0, count),
    profiles: rowsOf((i) => ({ id: uuid(i), full_name: `G${i}` })),
  }, inCalls);
  const named = (body: unknown): Array<{ user_id: string; full_name: string | null }> =>
    (body as { grants: Array<{ user_id: string; full_name: string | null }> }).grants;

  it('GET /teams/:id/access names every one of 1,101 grantees with URL-safe lookups', async () => {
    // The grants read has no `.in()`: every recorded list is a profile lookup.
    const inCalls: string[][] = [];
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, grantees(COUNT, inCalls));
    const response = await request(app).get(`/teams/${uuid(9003)}/access`);
    expect(response.status).toBe(200);
    expect(named(response.body)).toHaveLength(COUNT);
    expect(Math.max(...inCalls.map((call) => call.length))).toBeLessThanOrEqual(100);
    expect(inCalls.flat()).toHaveLength(COUNT);
  });

  it('GET /access/organization names all 1,101 grantees', async () => {
    const app = await mount('/access', async () => (await import('./access.js')).accessRouter, grantees(COUNT));
    const response = await request(app).get('/access/organization');
    expect(response.status).toBe(200);
    expect(named(response.body)).toHaveLength(COUNT);
    expect(named(response.body).every((grant) => grant.full_name !== null)).toBe(true);
  });

  it('PUT /teams/:id/access with 300 grantees answers with the committed set, named', async () => {
    const SIZE = 300;
    const app = await mount('/teams', async () => (await import('./teams.js')).teamsRouter, grantees(SIZE));
    const response = await request(app)
      .put(`/teams/${uuid(9003)}/access`)
      .send({ grants: rowsOf((i) => ({ user_id: uuid(i), capability: 'teams.manage' })).slice(0, SIZE) });
    expect(response.status).toBe(200);
    expect(named(response.body)).toHaveLength(SIZE);
    expect(named(response.body).at(-1)?.full_name).toBe(`G${SIZE - 1}`);
  });
});

describe('GET /calendar with hundreds of plans (W9-DATA-D3)', () => {
  it('returns every plan time and looks up my requests in URL-safe chunks', async () => {
    const inCalls: string[][] = [];
    const db = pagedDb({
      people: [{ id: 'me' }],
      plan_times: rowsOf((i) => ({
        id: uuid(i), kind: 'service', name: null, starts_at: '2026-12-01T10:00:00Z', ends_at: '2026-12-01T11:00:00Z',
        plan: { id: uuid(i), title: `Plan ${i}`, status: 'draft', location: null, service_type_id: null, service_type: null, assignments: [] },
      })),
    }, inCalls);
    const app = await mount('/calendar', async () => (await import('./calendar.js')).calendarRouter, db);
    const response = await request(app).get('/calendar').query({ from: '2026-11-01T00:00:00Z', to: '2027-12-31T00:00:00Z' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(COUNT);
    expect(Math.max(...inCalls.map((call) => call.length))).toBeLessThanOrEqual(100);
    expect(new Set(inCalls.flat()).size).toBe(COUNT);
  });
});

describe('GET /schedule/mine past the 1000-row cap (W9-DATA-D4)', () => {
  it('returns every one of 1,101 entries, sorted by service date', async () => {
    const db = pagedDb({
      people: [{ id: 'me' }],
      assignments: rowsOf((i) => ({
        id: uuid(i), person_id: 'me', status: 'confirmed', visibility: 'released', team: null, position: null,
        plan: { id: uuid(i), title: `Plan ${i}`, service_date: new Date(Date.UTC(2027, 0, 1) + (COUNT - i) * 86_400_000).toISOString(), location: null, status: 'draft', times: [] },
      })),
    });
    const app = await mount('/schedule', async () => (await import('./assignments.js')).scheduleRouter, db);
    const response = await request(app).get('/schedule/mine').query({ include_past: 'true' });
    expect(response.status).toBe(200);
    const entries = response.body as Array<{ assignment: { id: string }; plan: { service_date: string } }>;
    expect(new Set(entries.map((entry) => entry.assignment.id)).size).toBe(COUNT);
    expect(entries[0]?.assignment.id).toBe(uuid(COUNT - 1));
  });
});

describe('GET /folders past the 1000-row cap (W8-PERF-D2)', () => {
  it('returns every folder and files every service type', async () => {
    const db = pagedDb({
      service_type_folders: rowsOf((i) => ({ id: uuid(i), organization_id: 'org', parent_id: null, name: `F${i}`, sort_order: i, archived_at: null })),
      service_types: rowsOf((i) => ({ id: uuid(i), folder_id: i === COUNT - 1 ? uuid(0) : null })),
    });
    const app = await mount('/folders', async () => (await import('./folders.js')).foldersRouter, db);
    const response = await request(app).get('/folders');
    expect(response.status).toBe(200);
    const body = response.body as { folders: Array<{ id: string; service_type_ids: string[] }>; unfiled_service_type_ids: string[] };
    expect(body.folders).toHaveLength(COUNT);
    expect(body.folders.find((folder) => folder.id === uuid(0))?.service_type_ids).toEqual([uuid(COUNT - 1)]);
    expect(body.unfiled_service_type_ids).toHaveLength(COUNT - 1);
  });
});

describe('GET /service-types and GET /songbooks past the 1000-row cap', () => {
  it('returns every service type', async () => {
    const db = pagedDb({ service_types: rowsOf((i) => ({ id: uuid(i), name: `S${i}` })) });
    const app = await mount('/service-types', async () => (await import('./service-types.js')).serviceTypesRouter, db);
    const response = await request(app).get('/service-types');
    expect(response.status).toBe(200);
    expect(new Set(ids(response.body)).size).toBe(COUNT);
  });

  it('returns every song book', async () => {
    const db = pagedDb({ songbooks: rowsOf((i) => ({ id: uuid(i), title: `B${i}` })) });
    const app = await mount('/songbooks', async () => (await import('./songbooks.js')).songbooksRouter, db);
    const response = await request(app).get('/songbooks');
    expect(response.status).toBe(200);
    expect(new Set(ids(response.body)).size).toBe(COUNT);
  });
});

describe('POST /songbooks song ownership check chunks its .in() list', () => {
  it('verifies every selected song in bounded chunks, so none are dropped', async () => {
    const inCalls: string[][] = [];
    const songs = rowsOf((i) => ({ id: uuid(i), merged_into_song_id: null, merged_default_arrangement_id: null })).slice(0, SONGBOOK_SONGS);
    const app = await mount('/songbooks', async () => (await import('./songbooks.js')).songbooksRouter, pagedDb({ songs }, inCalls));
    const response = await request(app)
      .post('/songbooks')
      .send({ title: 'Big book', source_type: 'manual', songs: songs.map((song) => ({ song_id: song.id })) });
    // 400 would mean a song was missing; the fake has no insert, so the request fails later instead.
    expect(response.status).not.toBe(400);
    expect(inCalls.length).toBeGreaterThan(1);
    expect(Math.max(...inCalls.map((call) => call.length))).toBeLessThanOrEqual(100);
    expect(inCalls.flat()).toHaveLength(SONGBOOK_SONGS);
  });
});
