import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { AdminUserSummary, MyPlatformAdminInvitation } from '@service-center/shared';

/**
 * User and super-admin management under `/api/v1/admin`: super admins with a
 * two-factor session only, except the invitee's own invitation routes. The
 * services are fakes; the database functions check the actor again.
 */

const USER_ID = '0f6c4a6e-2a35-4d55-9a3f-5d1f2e1d9a10';
const INVITATION_ID = '7a1d2f3e-4b5c-4d6e-8f70-81a2b3c4d5e6';

interface Call {
  name: string;
  actor?: string;
  args: unknown[];
}

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return { admins: new Set<string>(), calls: [] as Call[] };
});

vi.mock('../services/platform-admin.js', () => ({
  isPlatformAdmin: async (userId: string) => fixture.admins.has(userId),
  purgeExpiredPlatformAccess: async () => 0,
}));

vi.mock('../services/platform-users.js', () => {
  const record =
    (name: string, result: unknown = undefined) =>
    async (actor: { userId: string } | string, ...args: unknown[]) => {
      fixture.calls.push({ name, actor: typeof actor === 'string' ? actor : actor.userId, args });
      return result;
    };
  const user: AdminUserSummary = {
    id: '0f6c4a6e-2a35-4d55-9a3f-5d1f2e1d9a10',
    email: 'uma@example.test',
    full_name: 'Uma',
    created_at: '2026-11-01T00:00:00Z',
    last_sign_in_at: null,
    email_confirmed: true,
    block: null,
    is_platform_admin: false,
    memberships: [],
  };
  const invitation: MyPlatformAdminInvitation = {
    id: '7a1d2f3e-4b5c-4d6e-8f70-81a2b3c4d5e6',
    email: 'pat@example.test',
    invited_by_name: 'Avery',
    created_at: '2026-11-01T00:00:00Z',
    expires_at: '2026-11-08T00:00:00Z',
  };
  return {
    listUsers: async () => [user],
    getUserDetail: record('getUserDetail', { user, deletion: { can_delete: true, churches: [] } }),
    blockUser: record('blockUser', { user_id: user.id }),
    unblockUser: record('unblockUser'),
    deleteUser: record('deleteUser', { deleted_organizations: [] }),
    listPlatformAdmins: async () => ({ admins: [], invitations: [] }),
    invitePlatformAdmin: record('invitePlatformAdmin', { id: invitation.id }),
    revokePlatformAdminInvitation: record('revokePlatformAdminInvitation'),
    revokePlatformAdmin: record('revokePlatformAdmin'),
    getMyPlatformAdminInvitation: record('getMyPlatformAdminInvitation', invitation),
    acceptPlatformAdminInvitation: record('acceptPlatformAdminInvitation'),
  };
});

const token = (aal: 'aal1' | 'aal2'): string =>
  ['h', Buffer.from(JSON.stringify({ sub: 'user-1', aal })).toString('base64url'), 's'].join('.');

let app: Express;
let session = { userId: 'user-1', aal: 'aal2' as 'aal1' | 'aal2' };

beforeAll(async () => {
  const { adminRouter } = await import('./admin.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: session.userId, email: 'pat@example.test', accessToken: token(session.aal) };
    next();
  });
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  fixture.admins = new Set(['user-1']);
  fixture.calls = [];
  session = { userId: 'user-1', aal: 'aal2' };
});

describe('/api/v1/admin users', () => {
  it('lists users for a two-factor super admin only', async () => {
    expect((await request(app).get('/api/v1/admin/users')).status).toBe(200);
    session.aal = 'aal1';
    expect((await request(app).get('/api/v1/admin/users')).body.code).toBe('mfa_required');
    fixture.admins.clear();
    session.aal = 'aal2';
    expect((await request(app).get('/api/v1/admin/users')).body.code).toBe('not_platform_admin');
  });

  it('refuses a user id that is not a uuid', async () => {
    expect((await request(app).get('/api/v1/admin/users/nope')).status).toBe(422);
  });

  it('needs a reason to block, and passes the actor and trimmed reason on', async () => {
    const empty = await request(app).post(`/api/v1/admin/users/${USER_ID}/block`).send({ reason: '   ' });
    expect(empty.status).toBe(422);
    const ok = await request(app).post(`/api/v1/admin/users/${USER_ID}/block`).send({ reason: ' Spam ' });
    expect(ok.status).toBe(200);
    expect(fixture.calls).toEqual([{ name: 'blockUser', actor: 'user-1', args: [USER_ID, 'Spam'] }]);
  });

  it('unblocks with no content', async () => {
    const response = await request(app).post(`/api/v1/admin/users/${USER_ID}/unblock`);
    expect(response.status).toBe(204);
    expect(fixture.calls[0]?.name).toBe('unblockUser');
  });

  it('needs the typed email to delete, lower-cased', async () => {
    const missing = await request(app).delete(`/api/v1/admin/users/${USER_ID}`).send({});
    expect(missing.status).toBe(422);
    const ok = await request(app).delete(`/api/v1/admin/users/${USER_ID}`).send({ confirm_email: ' Uma@Example.test ' });
    expect(ok.status).toBe(200);
    expect(fixture.calls).toEqual([{ name: 'deleteUser', actor: 'user-1', args: [USER_ID, 'uma@example.test'] }]);
  });
});

describe('/api/v1/admin super admins', () => {
  it('invites a valid email with a 7-day default', async () => {
    const bad = await request(app).post('/api/v1/admin/admins/invitations').send({ email: 'not-an-email' });
    expect(bad.status).toBe(422);
    const ok = await request(app).post('/api/v1/admin/admins/invitations').send({ email: ' New.Admin@Example.test ' });
    expect(ok.status).toBe(201);
    expect(fixture.calls).toEqual([
      { name: 'invitePlatformAdmin', actor: 'user-1', args: [{ email: 'new.admin@example.test', days: 7 }] },
    ]);
  });

  it('revokes an invitation and a super admin', async () => {
    expect((await request(app).delete(`/api/v1/admin/admins/invitations/${INVITATION_ID}`)).status).toBe(204);
    expect((await request(app).delete(`/api/v1/admin/admins/${USER_ID}`)).status).toBe(204);
    expect(fixture.calls.map((call) => call.name)).toEqual(['revokePlatformAdminInvitation', 'revokePlatformAdmin']);
  });

  it('lets someone who is not a super admin yet read and accept their own invitation', async () => {
    fixture.admins.clear();
    session = { userId: 'invitee-1', aal: 'aal1' };
    const mine = await request(app).get('/api/v1/admin/invitation');
    expect(mine.status).toBe(200);
    expect(mine.body.id).toBe(INVITATION_ID);
    const accepted = await request(app).post(`/api/v1/admin/invitation/${INVITATION_ID}/accept`);
    expect(accepted.status).toBe(204);
    expect(fixture.calls.map((call) => [call.name, call.actor])).toEqual([
      ['getMyPlatformAdminInvitation', 'invitee-1'],
      ['acceptPlatformAdminInvitation', 'invitee-1'],
    ]);
  });

  it('keeps the rest of the admin routes closed to the invitee', async () => {
    fixture.admins.clear();
    session = { userId: 'invitee-1', aal: 'aal2' };
    expect((await request(app).get('/api/v1/admin/admins')).status).toBe(403);
  });
});
