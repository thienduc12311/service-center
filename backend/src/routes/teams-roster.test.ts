import { beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { TeamRosterPersonRow, TeamWithPositions } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

const TEAM = '00000000-0000-4000-8000-0000000000aa';
const PERSON = '00000000-0000-4000-8000-0000000000cc';

interface Resolved<T> { data: T; error: null }
const rosterRows: TeamRosterPersonRow[] = [{
  team_id: TEAM, person_id: PERSON, first_name: 'Ada', last_name: 'Lovelace', avatar_url: null,
  email: 'ada@example.test', phone: '+1 555 0100', birthdate: '1990-04-05',
}];

describe('GET /teams roster profiles (W8-NAT-D1)', () => {
  let app: Express;
  /** `team_roster_people` is paged (`order` + `range`), so the fake result is a chain. */
  const rpc = vi.fn((_fn: string, _args: object) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      eq: () => chain, order: () => chain, range: () => chain,
      then: (resolve: (value: Resolved<TeamRosterPersonRow[]>) => unknown) => resolve({ data: rosterRows, error: null }),
    });
    return chain;
  });
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    // 'archived' has a membership but no roster row: `team_roster_people` hides archived People.
    const result = table === 'organization_members'
      ? [{ user_id: 'u1', role: 'member' }]
      : table === 'team_memberships'
        ? [{ id: 'm1', team_id: TEAM, person_id: PERSON, user_id: 'u1', position_id: null },
           { id: 'm2', team_id: TEAM, person_id: 'archived', user_id: null, position_id: null }]
        : [{ id: TEAM, organization_id: 'org', sort_order: 0, positions: [] }];
    Object.assign(chain, {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, range: () => chain, maybeSingle: () => ({
        then: (resolve: (value: Resolved<unknown>) => unknown) => resolve({ data: Array.isArray(result) ? result[0] : result, error: null }),
      }),
      then: (resolve: (value: Resolved<unknown>) => unknown) => resolve({ data: result, error: null }),
    });
    return chain;
  });

  beforeAll(async () => {
    const { teamsRouter } = await import('./teams.js');
    app = express();
    app.use((req, _res, next) => {
      req.orgId = 'org';
      req.orgRole = 'member';
      req.db = { from, rpc } as unknown as Db;
      next();
    });
    app.use('/teams', teamsRouter);
  });

  it('gives a non-owner name, email, phone and date of birth from the roster function', async () => {
    const response = await request(app).get('/teams');
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('team_roster_people', { p_org: 'org' });
    const [team] = response.body as TeamWithPositions[];
    expect(team?.members[0]?.profile).toEqual({
      id: PERSON, full_name: 'Ada Lovelace', avatar_url: null, email: 'ada@example.test',
      phone: '+1 555 0100', date_of_birth: '1990-04-05', role: 'member',
    });
    expect(team?.members).toHaveLength(1);
  });

  it('leaves an archived Person off the roster and its count, on the list and on one team (W9-WEB-D1 / W9-NAT-D1)', async () => {
    const list = await request(app).get('/teams');
    const one = await request(app).get(`/teams/${TEAM}`);
    expect(one.status).toBe(200);
    for (const team of [(list.body as TeamWithPositions[])[0], one.body as TeamWithPositions]) {
      expect(team?.members.map((member) => member.person_id)).toEqual([PERSON]);
      expect(team?.members.every((member) => member.profile !== null)).toBe(true);
    }
  });
});
