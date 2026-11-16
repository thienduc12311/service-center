import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../lib/supabase.js';
import type { PersonInvitationNotification } from './notifications.js';

/**
 * The shared "send an invitation" code behind "Send invite" and join-request
 * approvals. The database is a fake; `person_invitations_one_pending` and the
 * owner-only policy are in the migrations.
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  process.env.APP_URL = 'http://localhost:5173';
  return { emails: [] as PersonInvitationNotification[] };
});

vi.mock('./notifications.js', () => ({
  sendPersonInvitation: async (notification: PersonInvitationNotification) => {
    fixture.emails.push(notification);
  },
}));

import { ensurePersonInvitation, isReusableInvitation, issuePersonInvitation, type PersonInvitationRequest } from './person-invitations.js';

interface StoredInvitation {
  id: string;
  person_id: string;
  email: string;
  expires_at: string;
  revoked_at: string | null;
}

interface FakeResult {
  data: unknown;
  error: { code: string; message: string } | null;
}

/** A tiny `person_invitations` / `organizations` stand-in for the calls the service makes. */
const fakeDb = (invitations: StoredInvitation[], options: { raceOnInsert?: StoredInvitation } = {}): Db => {
  const live = () => invitations.find((invitation) => invitation.revoked_at === null) ?? null;
  return {
    from: (table: string) => {
      if (table === 'organizations') {
        const chain = { select: () => chain, eq: () => chain, single: async (): Promise<FakeResult> => ({ data: { name: 'Riverside' }, error: null }) };
        return chain;
      }
      let mode: 'read' | 'revoke' | 'insert' = 'read';
      let inserted: StoredInvitation | null = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        update: () => {
          mode = 'revoke';
          return chain;
        },
        insert: (values: { person_id: string; email: string; expires_at: string }) => {
          mode = 'insert';
          if (options.raceOnInsert) {
            invitations.push(options.raceOnInsert);
          } else {
            inserted = { id: `inv-${invitations.length + 1}`, revoked_at: null, ...values };
            invitations.push(inserted);
          }
          return chain;
        },
        maybeSingle: async (): Promise<FakeResult> => ({ data: live(), error: null }),
        single: async (): Promise<FakeResult> =>
          mode === 'insert' && !inserted
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: inserted ? { id: inserted.id } : null, error: null },
        then: (resolve: (value: FakeResult) => unknown) => {
          if (mode === 'revoke') {
            for (const invitation of invitations) invitation.revoked_at ??= '2026-11-16T00:00:00Z';
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return chain;
    },
  } as unknown as Db;
};

const request: PersonInvitationRequest = {
  organizationId: 'org-1',
  personId: 'person-1',
  email: 'jo@example.test',
  role: 'member',
  invitedBy: 'owner-1',
  personName: 'Jo Joiner',
  preferredLanguage: 'vi',
};

const future = '2099-01-01T00:00:00Z';

beforeEach(() => {
  fixture.emails = [];
});

describe('isReusableInvitation', () => {
  const now = new Date('2026-11-16T00:00:00Z');
  it('keeps an unexpired invitation to the same address, whatever its case', () => {
    expect(isReusableInvitation({ id: 'i', email: 'Jo@Example.test', expires_at: future }, 'jo@example.test', now)).toBe(true);
  });
  it('replaces an expired one or one to another address', () => {
    expect(isReusableInvitation({ id: 'i', email: 'jo@example.test', expires_at: '2026-11-15T00:00:00Z' }, 'jo@example.test', now)).toBe(false);
    expect(isReusableInvitation({ id: 'i', email: 'other@example.test', expires_at: future }, 'jo@example.test', now)).toBe(false);
  });
});

describe('issuePersonInvitation', () => {
  it('revokes the pending invitation, creates a new one and emails its link', async () => {
    const invitations: StoredInvitation[] = [{ id: 'old', person_id: 'person-1', email: 'jo@example.test', expires_at: future, revoked_at: null }];
    const sent = await issuePersonInvitation(fakeDb(invitations), request);
    expect(invitations[0]?.revoked_at).not.toBeNull();
    expect(sent.invitationId).toBe('inv-2');
    expect(sent.inviteUrl).toMatch(/^http:\/\/localhost:5173\/accept-invite\?token=/);
    expect(fixture.emails).toEqual([
      { to: 'jo@example.test', locale: 'vi', personName: 'Jo Joiner', organizationName: 'Riverside', acceptUrl: sent.inviteUrl },
    ]);
  });
});

describe('ensurePersonInvitation', () => {
  it('keeps a live invitation to the same address and sends nothing', async () => {
    const invitations: StoredInvitation[] = [{ id: 'old', person_id: 'person-1', email: 'jo@example.test', expires_at: future, revoked_at: null }];
    await expect(ensurePersonInvitation(fakeDb(invitations), request)).resolves.toEqual({ sent: false, invitationId: 'old', inviteUrl: null });
    expect(fixture.emails).toEqual([]);
  });

  it('sends a new one when the pending invitation went to another address', async () => {
    const invitations: StoredInvitation[] = [{ id: 'old', person_id: 'person-1', email: 'other@example.test', expires_at: future, revoked_at: null }];
    const result = await ensurePersonInvitation(fakeDb(invitations), request);
    expect(result).toMatchObject({ sent: true, invitationId: 'inv-2' });
    expect(fixture.emails).toHaveLength(1);
  });

  it('keeps the invitation a concurrent approval created first', async () => {
    const winner: StoredInvitation = { id: 'winner', person_id: 'person-1', email: 'jo@example.test', expires_at: future, revoked_at: null };
    const result = await ensurePersonInvitation(fakeDb([], { raceOnInsert: winner }), request);
    expect(result).toEqual({ sent: false, invitationId: 'winner', inviteUrl: null });
    expect(fixture.emails).toEqual([]);
  });
});
