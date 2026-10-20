import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryJob } from '../model/delivery.model.js';
import type { PushMessage } from '../model/notification.model.js';
import type { PushTicketResult } from './expo-push.js';

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return { rows: {} as Record<string, unknown>, access: true, feed: vi.fn(), send: vi.fn<(messages: PushMessage[]) => Promise<PushTicketResult[]>>() };
});

vi.mock('../lib/supabase.js', () => ({
  adminDb: {
    from: (table: string) => {
      let id = '';
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { if (column === 'id') id = value; return query; },
        maybeSingle: async () => ({ data: fixture.rows[`${table}:${id}`] ?? fixture.rows[table] ?? null, error: null }),
      };
      return query;
    },
    rpc: async () => ({ data: fixture.access, error: null }),
  },
  raw: (value: unknown) => value,
  unwrap: async (response: Promise<{ data: unknown }>) => (await response).data,
}));
vi.mock('./notification-center.js', () => ({ ensureFeedRows: fixture.feed, unreadCount: vi.fn() }));

vi.mock('./device-registrations.js', () => ({ activeDeviceTokens: async () => [{ token: 'ExponentPushToken[test]' }] }));
vi.mock('./expo-push.js', () => ({ pushTransport: () => ({ mode: 'expo', send: fixture.send }) }));

import { parsePushNavigationIntent } from '@service-center/shared';
import { dispatchDelivery } from './delivery-dispatch.js';

const job: DeliveryJob = {
  id: 'job', organizationId: 'org', effectId: 'effect', recipientId: 'recipient',
  recipientPersonId: 'person', channel: 'in_app', attempts: 1, maxAttempts: 5,
  leaseOwner: 'worker', locale: 'en',
};

beforeEach(() => {
  fixture.feed.mockReset();
  fixture.send.mockReset();
  fixture.access = true;
  fixture.rows = {
    delivery_effects: { id: 'effect', template: 'conversation_message', conversation_message_id: 'message' },
    'conversation_messages:message': {
      id: 'message', organization_id: 'org', conversation_id: 'conversation',
      author_id: 'author', author_person_id: 'author-person', body: 'Private rehearsal detail', reply_to_id: null,
    },
    people: { profile_id: 'recipient', archived_at: null, first_name: 'Alex' },
    organization_members: { user_id: 'recipient' },
    conversation_member_states: { muted: false },
    conversations: { kind: 'team', team_id: 'team', plan_id: null },
    teams: { name: 'Band' },
  };
});

describe('conversation delivery revalidation', () => {
  it.each(['conversation_message', 'conversation_reply', 'conversation_mention'] as const)(
    'classifies %s without falsely calling ordinary messages replies', async (type) => {
      if (type !== 'conversation_message') {
        fixture.rows['conversation_messages:message'] = {
          ...fixture.rows['conversation_messages:message'] as Record<string, unknown>, reply_to_id: 'original',
        };
        fixture.rows['conversation_messages:original'] = { author_id: 'recipient' };
      }
      if (type === 'conversation_mention') fixture.rows.conversation_message_mentions = { person_id: 'person' };
      expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'delivered' });
      expect(fixture.feed).toHaveBeenCalledOnce();
      expect(fixture.feed).toHaveBeenCalledWith([expect.objectContaining({
        type, conversationId: 'conversation', dedupeKey: 'effect:person',
      })]);
    },
  );

  it('sends an ordinary-message push accepted by the mobile parser', async () => {
    fixture.feed.mockResolvedValue([{
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      plan_id: null, type: 'conversation_message', title: 'Private name', body: 'Private content',
    }]);
    fixture.send.mockResolvedValue([{ token: 'ExponentPushToken[test]', accepted: true, ticketId: 'ticket', error: null }]);
    const begin = vi.fn(async () => true);
    expect(await dispatchDelivery({ ...job, channel: 'push' }, begin)).toMatchObject({ status: 'provider_accepted' });
    expect(begin).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledOnce();
    const messages = fixture.send.mock.calls[0]?.[0];
    if (!messages?.[0]) throw new Error('Expected a push message');
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Open the app to view a new chat message.');
    expect(parsePushNavigationIntent(messages[0].data)).toMatchObject({ status: 'accepted' });
    expect(JSON.stringify(messages)).not.toContain('Private');
  });

  it.each(['in_app', 'push'] as const)('cancels queued %s when muted after enqueue', async (channel) => {
    fixture.rows.conversation_member_states = { muted: true };
    const begin = vi.fn();
    expect(await dispatchDelivery({ ...job, channel }, begin)).toEqual({ status: 'cancelled', errorCode: 'conversation_muted' });
    expect(fixture.feed).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it('cancels after conversation membership is revoked', async () => {
    fixture.access = false;
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'recipient_not_eligible' });
    expect(fixture.feed).not.toHaveBeenCalled();
  });

  it.each(['deleted_at', 'hidden_at'])('cancels when content becomes %s', async (field) => {
    fixture.rows['conversation_messages:message'] = {
      ...fixture.rows['conversation_messages:message'] as Record<string, unknown>, [field]: '2026-10-19T00:00:00Z',
    };
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'content_removed' });
    expect(fixture.feed).not.toHaveBeenCalled();
  });
});
