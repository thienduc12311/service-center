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
  const rpc = vi.fn((_fn: string, _args: object): Promise<Resolved<TeamRosterPersonRow[]>> => Promise.resolve({ data: rosterRows, error: null }));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    const result = table === 'organization_members'
      ? [{ user_id: 'u1', role: 'member' }]
      : [{ id: TEAM, organization_id: 'org', sort_order: 0, positions: [],
          memberships: [{ id: 'm1', person_id: PERSON, user_id: 'u1', position_id: null },
                        { id: 'm2', person_id: 'missing', user_id: null, position_id: null }] }];
    Object.assign(chain, {
      select: () => chain, eq: () => chain, order: () => chain,
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
    expect(team?.members[1]?.profile).toBeNull();
  });
});
