import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * `POST /api/v1/invitations/:token/accept` finds an existing login only by its
 * confirmed auth email (`confirmed_user_id_by_email`), never by
 * `profiles.email`, which a signed-in user could once overwrite. The database
 * is a fake.
 */

interface CreateUserCall {
  email: string;
  password: string;
  email_confirm: boolean;
}

interface ResendCall {
  type: string;
  email: string;
}

interface AcceptCall {
  p_token_hash: string;
  p_new_user_id: string;
}

interface AuthErrorFake {
  message: string;
  code: string;
}

interface Fixture {
  /** What confirmed_user_id_by_email answers. */
  confirmedUserId: string | null;
  lookups: string[];
  createUserError: AuthErrorFake | null;
  createUserCalls: CreateUserCall[];
  /** Access token -> user id the fake Auth server accepts. */
  sessions: Record<string, string>;
  resendError: AuthErrorFake | null;
  resendCalls: ResendCall[];
  acceptCalls: AcceptCall[];
  profileReads: number;
}

const fixture = vi.hoisted((): Fixture => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return {
    confirmedUserId: null,
    lookups: [],
    createUserError: null,
    createUserCalls: [],
    sessions: {},
    resendError: null,
    resendCalls: [],
    acceptCalls: [],
    profileReads: 0,
  };
});

const INVITATION = {
  id: 'inv-1',
  organization_id: 'org-1',
  person_id: 'person-1',
  email: 'invitee@example.test',
  role: 'member',
  accepted_at: null,
  revoked_at: null,
  expires_at: '2999-01-01T00:00:00Z',
};

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  const single = <T>(data: T) => ({
    maybeSingle: () => Promise.resolve({ data, error: null }),
    single: () => Promise.resolve({ data, error: null }),
  });
  const from = (table: string) => {
    if (table === 'profiles') fixture.profileReads += 1;
    return {
      select: () => ({
        eq: () => {
          if (table === 'person_invitations') return single(INVITATION);
          if (table === 'people') return single({ first_name: 'Ivy', last_name: 'Invitee', preferred_language: null });
          if (table === 'organizations') return single({ name: 'Riverside' });
          throw new Error(`unexpected table ${table}`);
        },
      }),
    };
  };
  const rpc = (fn: string, args: Record<string, string>) => {
    if (fn === 'confirmed_user_id_by_email') {
      fixture.lookups.push(args.p_email ?? '');
      return Promise.resolve({ data: fixture.confirmedUserId, error: null });
    }
    if (fn === 'accept_person_invitation') {
      fixture.acceptCalls.push({ p_token_hash: args.p_token_hash ?? '', p_new_user_id: args.p_new_user_id ?? '' });
      return Promise.resolve({ data: [{ out_status: 'linked' }], error: null });
    }
    throw new Error(`unexpected rpc ${fn}`);
  };
  const createUser = (input: CreateUserCall) => {
    fixture.createUserCalls.push({ email: input.email, password: input.password, email_confirm: input.email_confirm });
    if (fixture.createUserError) return Promise.resolve({ data: { user: null }, error: fixture.createUserError });
    return Promise.resolve({ data: { user: { id: 'new-user' } }, error: null });
  };
  const getUser = (token: string) => {
    const id = fixture.sessions[token];
    if (!id) return Promise.resolve({ data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'bad jwt' } });
    return Promise.resolve({ data: { user: { id, email: 'whoever@example.test', banned_until: null } }, error: null });
  };
  const resend = (input: ResendCall) => {
    fixture.resendCalls.push({ type: input.type, email: input.email });
    return Promise.resolve({ data: {}, error: fixture.resendError });
  };
  return { ...actual, adminDb: { from, rpc, auth: { getUser, resend, admin: { createUser } } } };
});

let app: Express;

beforeAll(async () => {
  const { invitationAcceptRouter } = await import('./invitation-accept.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  app = express();
  app.use(express.json());
  app.use('/api/v1/invitations', invitationAcceptRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  fixture.confirmedUserId = null;
  fixture.lookups = [];
  fixture.createUserError = null;
  fixture.createUserCalls = [];
  fixture.sessions = {};
  fixture.resendError = null;
  fixture.resendCalls = [];
  fixture.acceptCalls = [];
  fixture.profileReads = 0;
});

describe('POST /api/v1/invitations/:token/accept', () => {
  it('links an existing confirmed login only from its own session, without reading profiles', async () => {
    fixture.confirmedUserId = 'existing-user';
    fixture.sessions = { 'existing-token': 'existing-user' };
    const res = await request(app).post('/api/v1/invitations/tok/accept').set('Authorization', 'Bearer existing-token').send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: INVITATION.email, linked_existing_account: true });
    expect(fixture.lookups).toEqual([INVITATION.email]);
    expect(fixture.acceptCalls.map((call) => call.p_new_user_id)).toEqual(['existing-user']);
    expect(fixture.createUserCalls).toEqual([]);
    expect(fixture.profileReads).toBe(0);
  });

  // SEC-002: the inviter can see the link, so the token alone must not attach someone's account.
  it('refuses to link an existing login for a caller who is not signed in to it', async () => {
    fixture.confirmedUserId = 'existing-user';
    const res = await request(app).post('/api/v1/invitations/tok/accept').send({ password: 'long-enough-pw' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('invitation_sign_in_required');
    expect(fixture.acceptCalls).toEqual([]);
    expect(fixture.createUserCalls).toEqual([]);
  });

  it('refuses to link an existing login for someone signed in as a different account', async () => {
    fixture.confirmedUserId = 'existing-user';
    fixture.sessions = { 'inviter-token': 'inviter' };
    const res = await request(app).post('/api/v1/invitations/tok/accept').set('Authorization', 'Bearer inviter-token').send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('invitation_sign_in_required');
    expect(fixture.acceptCalls).toEqual([]);
  });

  it('rejects a stale session instead of treating it as signed out', async () => {
    fixture.confirmedUserId = 'existing-user';
    const res = await request(app).post('/api/v1/invitations/tok/accept').set('Authorization', 'Bearer expired').send({});
    expect(res.status).toBe(401);
    expect(fixture.acceptCalls).toEqual([]);
  });

  // SEC-002: an account made from a link must not count as owning the address.
  it('creates a new account with its email unconfirmed and sends the confirmation email', async () => {
    const res = await request(app).post('/api/v1/invitations/tok/accept').send({ password: 'long-enough-pw' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: INVITATION.email, linked_existing_account: false });
    expect(fixture.createUserCalls).toEqual([{ email: INVITATION.email, password: 'long-enough-pw', email_confirm: false }]);
    expect(fixture.resendCalls).toEqual([{ type: 'signup', email: INVITATION.email }]);
    expect(fixture.acceptCalls.map((call) => call.p_new_user_id)).toEqual(['new-user']);
    expect(fixture.profileReads).toBe(0);
  });

  it('still joins when the confirmation email could not be sent', async () => {
    fixture.resendError = { message: 'rate limited', code: 'over_email_send_rate_limit' };
    const res = await request(app).post('/api/v1/invitations/tok/accept').send({ password: 'long-enough-pw' });
    expect(res.status).toBe(200);
    expect(fixture.acceptCalls.map((call) => call.p_new_user_id)).toEqual(['new-user']);
  });

  it('asks for a password when there is no confirmed login to link', async () => {
    const res = await request(app).post('/api/v1/invitations/tok/accept').send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('password_required');
    expect(fixture.acceptCalls).toEqual([]);
  });

  it('never links an unconfirmed signup that holds the address', async () => {
    fixture.createUserError = { message: 'A user with this email address has already been registered', code: 'email_exists' };
    const res = await request(app).post('/api/v1/invitations/tok/accept').send({ password: 'long-enough-pw' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('account_unconfirmed');
    expect(fixture.acceptCalls).toEqual([]);
    expect(fixture.resendCalls).toEqual([]);
  });
});
