import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type { EffectiveAccessEntry } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/** The delete chain: from().delete().eq().eq().select() resolves to the removed rows. */
interface DeleteResult {
  data: Array<{ id: string }> | null;
  error: null;
}

const TEAM = '00000000-0000-4000-8000-0000000000aa';
const MEMBERSHIP = '00000000-0000-4000-8000-0000000000bb';

const entry = (source: EffectiveAccessEntry['source'], scope_type: EffectiveAccessEntry['scope_type'] = 'organization', scope_id: string | null = null): EffectiveAccessEntry => ({
  capability: 'teams.manage', scope_type, scope_id, source, grant_id: null,
});

describe('Team roster changes', () => {
  let app: Express;
  let entries: EffectiveAccessEntry[] = [];
  let removed: DeleteResult = { data: [{ id: MEMBERSHIP }], error: null };
  const from = vi.fn((_table: string) => {
    const chain = {
      delete: () => chain,
      eq: () => chain,
      select: () => Promise.resolve(removed),
    };
    return chain;
  });

  beforeAll(async () => {
    const { teamsRouter } = await import('./teams.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.orgId = 'org';
      req.orgRole = 'member';
      req.auth = { userId: 'self', email: 'self@example.test', accessToken: 'token' };
      req.access = { organization_id: 'org', user_id: 'self', role: 'member', access_mode: 'legacy', can_administer_access: false, entries };
      req.db = { from } as unknown as Db;
      next();
    });
    app.use('/teams', teamsRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    from.mockClear();
    removed = { data: [{ id: MEMBERSHIP }], error: null };
  });

  it('refuses a scheduler whose only team access is the legacy role', async () => {
    entries = [entry('role:scheduler_legacy')];
    const remove = await request(app).delete(`/teams/${TEAM}/members/${MEMBERSHIP}`);
    const add = await request(app).post(`/teams/${TEAM}/members`).send({ person_id: MEMBERSHIP });
    expect(remove.status).toBe(403);
    expect(add.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  for (const [label, access] of [
    ['an owner', [entry('role:owner')]],
    ['an admin', [entry('role:admin')]],
    ['a team leader', [entry('grant', 'team', TEAM)]],
  ] as const) {
    it(`lets ${label} remove a member`, async () => {
      entries = [...access];
      const response = await request(app).delete(`/teams/${TEAM}/members/${MEMBERSHIP}`);
      expect(response.status).toBe(204);
      expect(from).toHaveBeenCalledWith('team_memberships');
    });
  }

  it('reports a membership RLS would not let them remove as not found', async () => {
    entries = [entry('grant', 'team', 'another-team')];
    removed = { data: [], error: null };
    const response = await request(app).delete(`/teams/${TEAM}/members/${MEMBERSHIP}`);
    expect(response.status).toBe(404);
  });
});
