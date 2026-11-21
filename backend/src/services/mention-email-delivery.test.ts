import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MentionEmailBatchRow } from '@service-center/shared';
import type { DeliveryJob } from '../model/delivery.model.js';
import type { EmailNotification, EmailSendOptions, EmailSendReceipt } from './notifications.js';

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return {
    rows: {} as Record<string, unknown>,
    access: true,
    batch: [] as MentionEmailBatchRow[],
    feed: vi.fn(),
  };
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
    rpc: async (name: string) => ({ data: name === 'mention_email_batch' ? fixture.batch : fixture.access, error: null }),
  },
  raw: (value: unknown) => value,
  unwrap: async (response: Promise<{ data: unknown }>) => (await response).data,
}));
vi.mock('./notification-center.js', () => ({ ensureFeedRows: fixture.feed, unreadCount: async () => 0 }));

import { dispatchDelivery } from './delivery-dispatch.js';
import { isAvailabilityRequest, isMentionEmail, isOperationalMessage, isSchedulerResponse, isServiceReminder, setNotificationTransport } from './notifications.js';
import { mentionEmailDelaySeconds } from './discussions.js';
import { config } from '../config.js';

const sent: Array<{ notification: EmailNotification; options: EmailSendOptions | undefined }> = [];
setNotificationTransport({
  mode: 'resend',
  async send(notification: EmailNotification, options?: EmailSendOptions): Promise<EmailSendReceipt> {
    sent.push({ notification, options });
    return { providerMessageId: 'provider-1' };
  },
});

const job: DeliveryJob = {
  id: 'job', organizationId: 'org', effectId: 'effect', recipientId: 'recipient',
  recipientPersonId: 'person', channel: 'email', attempts: 1, maxAttempts: 5,
  leaseOwner: 'worker', locale: 'en',
};

const batchRow = (count: number, body = '@Riley can you bring the capo?'): MentionEmailBatchRow => ({
  mention_count: count,
  latest_id: count ? 'latest' : null,
  latest_body: count ? body : null,
  latest_author_id: count ? 'author' : null,
  latest_author_person_id: count ? 'author-person' : null,
  latest_created_at: count ? '2026-11-21T10:00:00Z' : null,
});

const chatRows = (): Record<string, unknown> => ({
  delivery_effects: { id: 'effect', template: 'conversation_message', conversation_message_id: 'message' },
  'conversation_messages:message': {
    id: 'message', organization_id: 'org', conversation_id: 'conversation',
    author_id: 'author', author_person_id: 'author-person', body: '@Riley first', reply_to_id: null,
  },
  people: { profile_id: 'recipient', archived_at: null, first_name: 'Riley', last_name: null, email: 'riley@person.test' },
  'people:author-person': { first_name: 'Sam', last_name: 'Lee' },
  profiles: { full_name: 'Riley Q', email: 'riley@example.test' },
  organization_members: { user_id: 'recipient' },
  organizations: { name: 'Riverside' },
  conversation_member_states: { muted: false },
  conversations: { kind: 'team', team_id: 'team', plan_id: null },
  conversation_message_mentions: { person_id: 'person' },
  teams: { name: 'Band' },
});

const commentRows = (): Record<string, unknown> => ({
  delivery_effects: { id: 'effect', template: 'item_comment', comment_id: 'comment' },
  'plan_item_comments:comment': {
    id: 'comment', organization_id: 'org', plan_id: 'plan', plan_item_id: 'item',
    author_id: 'author', author_person_id: 'author-person', body: '@Riley lyrics?', deleted_at: null,
  },
  plan_items: { title: 'Welcome' },
  plan_item_comment_mentions: { person_id: 'person' },
  people: { profile_id: 'recipient', archived_at: null, first_name: 'Riley', last_name: null, email: null },
  'people:author-person': { first_name: 'Sam', last_name: 'Lee' },
  profiles: { full_name: 'Riley Q', email: 'riley@example.test' },
  organization_members: { user_id: 'recipient' },
  organizations: { name: 'Riverside' },
});

beforeEach(() => {
  sent.length = 0;
  fixture.feed.mockReset();
  fixture.access = true;
  fixture.batch = [batchRow(1)];
  fixture.rows = chatRows();
});

describe('mention email delay', () => {
  it('waits ten minutes only when the scheduled worker is configured', () => {
    expect(mentionEmailDelaySeconds(true)).toBe(600);
    expect(mentionEmailDelaySeconds(false)).toBe(0);
  });
});

describe('mention email notification type', () => {
  it('is recognized only by its own guard', () => {
    const notification = {
      to: 'a@b.test', locale: 'en', personName: null, organizationName: 'Riverside', authorName: 'Sam',
      place: 'Band chat', excerpt: 'hi', moreCount: 0, threadUrl: 'https://app.test/chat/c',
    };
    expect(isMentionEmail(notification)).toBe(true);
    expect(isSchedulerResponse(notification) || isOperationalMessage(notification)
      || isAvailabilityRequest(notification) || isServiceReminder(notification)).toBe(false);
  });
});

describe('chat mention email', () => {
  it('sends the latest unread mention, counts the rest and keys it on the delivery', async () => {
    fixture.batch = [batchRow(2, '@Riley and the spare strings')];
    const begin = vi.fn(async () => true);
    expect(await dispatchDelivery(job, begin)).toEqual({ status: 'provider_accepted', providerMessageId: 'provider-1' });
    expect(begin).toHaveBeenCalledOnce();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.notification).toEqual({
      to: 'riley@example.test',
      locale: 'en',
      personName: 'Riley Q',
      organizationName: 'Riverside',
      authorName: 'Sam Lee',
      place: 'Band chat',
      excerpt: '@Riley and the spare strings',
      moreCount: 1,
      threadUrl: `${config.APP_URL}/chat/conversation`,
    });
    expect(sent[0]?.options).toEqual({ idempotencyKey: 'delivery-job' });
    expect(fixture.feed).not.toHaveBeenCalled();
  });

  it('cuts the excerpt at 280 characters', async () => {
    fixture.batch = [batchRow(1, 'word '.repeat(100))];
    await dispatchDelivery(job, vi.fn(async () => true));
    const notification = sent[0]?.notification;
    expect(notification && isMentionEmail(notification) ? notification.excerpt.length : 0).toBeLessThanOrEqual(280);
  });

  it('is cancelled when the mention was read before the email was due', async () => {
    fixture.batch = [batchRow(0)];
    const begin = vi.fn();
    expect(await dispatchDelivery(job, begin)).toEqual({ status: 'cancelled', errorCode: 'already_read' });
    expect(begin).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('is cancelled when the chat was muted after the mention', async () => {
    fixture.rows.conversation_member_states = { muted: true };
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'conversation_muted' });
    expect(sent).toHaveLength(0);
  });

  it('is cancelled when the recipient lost access', async () => {
    fixture.access = false;
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'recipient_not_eligible' });
    expect(sent).toHaveLength(0);
  });

  it('honors an opt-out made while the email was queued', async () => {
    fixture.rows.person_reminder_preferences = { mention_email: false };
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'skipped', errorCode: 'channel_not_used' });
    expect(sent).toHaveLength(0);
  });

  it('never emails an ordinary message', async () => {
    fixture.rows.conversation_message_mentions = null;
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'skipped', errorCode: 'channel_not_used' });
    expect(sent).toHaveLength(0);
  });

  it('skips when there is no address any more', async () => {
    fixture.rows.profiles = { full_name: 'Riley Q', email: null };
    fixture.rows.people = { ...(fixture.rows.people as Record<string, unknown>), email: null };
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'skipped', errorCode: 'no_email_address' });
  });
});

describe('item discussion mention email', () => {
  beforeEach(() => {
    fixture.rows = commentRows();
  });

  it('names the item and links to the plan', async () => {
    expect(await dispatchDelivery(job, vi.fn(async () => true))).toMatchObject({ status: 'provider_accepted' });
    expect(sent[0]?.notification).toMatchObject({
      place: '“Welcome”',
      authorName: 'Sam Lee',
      moreCount: 0,
      threadUrl: `${config.APP_URL}/plans/plan`,
    });
    expect(sent[0]?.options).toEqual({ idempotencyKey: 'delivery-job' });
  });

  it('is cancelled when the mention feed row was marked read', async () => {
    fixture.batch = [batchRow(0)];
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'already_read' });
    expect(sent).toHaveLength(0);
  });

  it('is cancelled when the comment was deleted', async () => {
    fixture.rows['plan_item_comments:comment'] = {
      ...(fixture.rows['plan_item_comments:comment'] as Record<string, unknown>), deleted_at: '2026-11-21T10:00:00Z',
    };
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'content_removed' });
  });
});
