import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApproveChurchJoinRequestRow, MyChurchJoinRequestRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import type { OwnerChurchJoinRequestRow } from '../model/church-join-request.model.js';
import type { EnsuredPersonInvitation, PersonInvitationRequest } from './person-invitations.js';

/**
 * Join requests as the caller. The database is a fake: who may see and decide
 * requests, and the one-pending rule, live in migration 20261117000000 (see
 * supabase/tests/church-join-requests.sql). The invitation step is the shared
 * person-invitation code, faked here and tested in person-invitations.test.ts.
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return {
    invitations: [] as PersonInvitationRequest[],
    invitation: null as EnsuredPersonInvitation | null,
  };
});

vi.mock('./person-invitations.js', () => ({
  ensurePersonInvitation: async (_db: Db, request: PersonInvitationRequest): Promise<EnsuredPersonInvitation> => {
    fixture.invitations.push(request);
    if (!fixture.invitation) throw new Error('No invitation prepared');
    return fixture.invitation;
  },
}));

import {
  approveJoinRequest,
  declineJoinRequest,
  lookupChurch,
  requestToJoin,
  withdrawMyJoinRequest,
} from './church-join-requests.js';

/** A PostgREST answer. */
interface FakeResult {
  data: unknown;
  error: { code: string; message: string; hint?: string } | null;
}

/** The parts of a query builder the service uses, all returning the same answer. */
interface FakeQuery extends PromiseLike<FakeResult> {
  select: () => FakeQuery;
  update: (values: Record<string, unknown>) => FakeQuery;
  eq: () => FakeQuery;
  neq: () => FakeQuery;
  gte: () => FakeQuery;
  order: () => FakeQuery;
  limit: () => FakeQuery;
  single: () => Promise<FakeResult>;
  maybeSingle: () => Promise<FakeResult>;
}

const query = (result: () => FakeResult, onUpdate?: (values: Record<string, unknown>) => void): FakeQuery => {
  const builder: FakeQuery = {
    select: () => builder,
    update: (values) => {
      onUpdate?.(values);
      return builder;
    },
    eq: () => builder,
    neq: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
};

const ok = (data: unknown): FakeResult => ({ data, error: null });

interface FakeDatabase {
  /** Answers by function name. */
  rpc: Record<string, (args: Record<string, unknown>) => FakeResult>;
  /** What a `church_join_requests` select answers. */
  requestRow: OwnerChurchJoinRequestRow | null;
  /** What the requester's withdraw update matched. */
  withdrawn: { id: string } | null;
  calls: Array<{ fn: string; args: Record<string, unknown> }>;
}

let database: FakeDatabase;

const fakeDb = (): Db =>
  ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      database.calls.push({ fn, args });
      const handler = database.rpc[fn];
      if (!handler) throw new Error(`Unexpected rpc ${fn}`);
      return query(() => handler(args));
    },
    from: (table: string) => {
      if (table !== 'church_join_requests') throw new Error(`Unexpected table ${table}`);
      let updating = false;
      return query(
        () => (updating ? ok(database.withdrawn) : ok(database.requestRow)),
        () => {
          updating = true;
        },
      );
    },
  }) as unknown as Db;

const owner = () => ({ db: fakeDb(), userId: 'owner-1', organizationId: 'org-1' });
const requester = () => ({ db: fakeDb(), userId: 'user-1' });

const requestRow = (overrides: Partial<OwnerChurchJoinRequestRow> = {}): OwnerChurchJoinRequestRow => ({
  id: 'req-1',
  organization_id: 'org-1',
  requester_id: 'user-1',
  status: 'pending',
  message: 'Hi',
  requester_name: 'Jo Joiner',
  requester_email: 'jo@example.test',
  decline_reason: null,
  person_id: null,
  invitation_id: null,
  decided_at: null,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
  ...overrides,
});

const decision = (overrides: Partial<ApproveChurchJoinRequestRow> = {}): ApproveChurchJoinRequestRow => ({
  out_request_id: 'req-1',
  out_organization_id: 'org-1',
  out_person_id: 'person-1',
  out_invitation_id: null,
  out_email: 'jo@example.test',
  out_first_name: 'Jo',
  out_last_name: 'Joiner',
  out_preferred_language: 'vi',
  out_newly_approved: true,
  ...overrides,
});

const myRow = (overrides: Partial<MyChurchJoinRequestRow> = {}): MyChurchJoinRequestRow => ({
  id: 'req-1',
  organization_id: 'org-1',
  organization_name: 'Riverside',
  organization_slug: 'riverside',
  status: 'pending',
  message: null,
  decline_reason: null,
  decided_at: null,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  fixture.invitations = [];
  fixture.invitation = { sent: true, invitationId: 'inv-1', inviteUrl: 'http://localhost:5173/accept-invite?token=t' };
  database = { rpc: {}, requestRow: requestRow(), withdrawn: null, calls: [] };
});

describe('lookupChurch', () => {
  it('returns the church with the slug that was looked up', async () => {
    database.rpc.find_church_by_slug = () => ok([{ id: 'org-1', name: 'Riverside' }]);
    await expect(lookupChurch(requester(), 'riverside')).resolves.toEqual({ id: 'org-1', name: 'Riverside', slug: 'riverside' });
  });

  it('answers 404 church_not_found when nothing matches (unknown or disabled)', async () => {
    database.rpc.find_church_by_slug = () => ok([]);
    await expect(lookupChurch(requester(), 'closed')).rejects.toMatchObject({ status: 404, code: 'church_not_found' });
  });
});

describe('requestToJoin', () => {
  it('creates the request and returns it with the church name', async () => {
    database.rpc.request_to_join_church = () => ok('req-1');
    database.rpc.my_church_join_requests = () => ok([myRow({ message: 'Hello' })]);
    const created = await requestToJoin(requester(), { slug: 'riverside', message: 'Hello' });
    expect(created).toMatchObject({ id: 'req-1', organization_name: 'Riverside', status: 'pending', message: 'Hello' });
    expect(database.calls[0]).toEqual({ fn: 'request_to_join_church', args: { p_slug: 'riverside', p_message: 'Hello' } });
  });

  it('passes the database refusals through as API codes', async () => {
    database.rpc.request_to_join_church = () => ({
      data: null,
      error: { code: 'PT409', message: 'You already asked', hint: 'join_request_pending' },
    });
    await expect(requestToJoin(requester(), { slug: 'riverside', message: null })).rejects.toMatchObject({
      status: 409,
      code: 'join_request_pending',
    });
  });
});

describe('withdrawMyJoinRequest', () => {
  it('returns the withdrawn request', async () => {
    database.withdrawn = { id: 'req-1' };
    database.rpc.my_church_join_requests = () => ok([myRow({ status: 'withdrawn' })]);
    await expect(withdrawMyJoinRequest(requester(), 'req-1')).resolves.toMatchObject({ status: 'withdrawn' });
  });

  it('explains a request that was decided meanwhile', async () => {
    database.rpc.my_church_join_requests = () => ok([myRow({ status: 'approved' })]);
    await expect(withdrawMyJoinRequest(requester(), 'req-1')).rejects.toMatchObject({
      status: 409,
      code: 'join_request_not_pending',
    });
  });

  it('answers 404 for someone else\'s request', async () => {
    database.rpc.my_church_join_requests = () => ok([]);
    await expect(withdrawMyJoinRequest(requester(), 'req-1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('approveJoinRequest', () => {
  it('approves, sends the normal invitation as a member and records it', async () => {
    database.rpc.approve_church_join_request = () => ok(decision());
    database.rpc.record_church_join_request_invitation = () => ok(requestRow({ status: 'approved', invitation_id: 'inv-1' }));
    database.requestRow = requestRow({ status: 'approved', person_id: 'person-1', invitation_id: 'inv-1' });

    const approval = await approveJoinRequest(owner(), 'req-1');

    expect(fixture.invitations).toEqual([
      {
        organizationId: 'org-1',
        personId: 'person-1',
        email: 'jo@example.test',
        role: 'member',
        invitedBy: 'owner-1',
        personName: 'Jo Joiner',
        preferredLanguage: 'vi',
      },
    ]);
    expect(database.calls.map((call) => call.fn)).toEqual([
      'approve_church_join_request',
      'record_church_join_request_invitation',
    ]);
    expect(database.calls[1]?.args).toEqual({ p_request: 'req-1', p_invitation: 'inv-1' });
    expect(approval).toMatchObject({
      invitation_sent: true,
      invite_url: 'http://localhost:5173/accept-invite?token=t',
      request: { id: 'req-1', status: 'approved', invitation_id: 'inv-1' },
    });
    expect(approval.request).not.toHaveProperty('organization_id');
  });

  it('records a kept invitation on a retry whose first attempt stopped before recording', async () => {
    fixture.invitation = { sent: false, invitationId: 'inv-0', inviteUrl: null };
    database.rpc.approve_church_join_request = () => ok(decision({ out_newly_approved: false }));
    database.rpc.record_church_join_request_invitation = () => ok(requestRow());
    const approval = await approveJoinRequest(owner(), 'req-1');
    expect(database.calls[1]?.args).toEqual({ p_request: 'req-1', p_invitation: 'inv-0' });
    expect(approval).toMatchObject({ invitation_sent: false, invite_url: null });
  });

  it('sends nothing when the invitation was already recorded', async () => {
    database.rpc.approve_church_join_request = () => ok(decision({ out_invitation_id: 'inv-1', out_newly_approved: false }));
    const approval = await approveJoinRequest(owner(), 'req-1');
    expect(fixture.invitations).toEqual([]);
    expect(database.calls.map((call) => call.fn)).toEqual(['approve_church_join_request']);
    expect(approval).toMatchObject({ invitation_sent: false, invite_url: null });
  });

  it('tells the owner when the requester joined meanwhile', async () => {
    database.rpc.approve_church_join_request = () => ({
      data: null,
      error: { code: 'PT409', message: 'already part', hint: 'already_church_member' },
    });
    await expect(approveJoinRequest(owner(), 'req-1')).rejects.toMatchObject({
      status: 409,
      code: 'requester_already_member',
    });
    expect(fixture.invitations).toEqual([]);
  });

  it('changes nothing for a request outside the active church', async () => {
    database.requestRow = null;
    await expect(approveJoinRequest(owner(), 'req-1')).rejects.toMatchObject({ status: 404 });
    expect(database.calls).toEqual([]);
  });
});

describe('declineJoinRequest', () => {
  it('declines with the reason', async () => {
    database.rpc.decline_church_join_request = () => ok(requestRow({ status: 'declined' }));
    database.requestRow = requestRow({ status: 'declined', decline_reason: 'Not now' });
    const declined = await declineJoinRequest(owner(), 'req-1', { reason: 'Not now' });
    expect(database.calls[0]).toEqual({ fn: 'decline_church_join_request', args: { p_request: 'req-1', p_reason: 'Not now' } });
    expect(declined).toMatchObject({ status: 'declined', decline_reason: 'Not now' });
  });
});
