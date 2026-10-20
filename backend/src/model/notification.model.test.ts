import { describe, expect, it } from 'vitest';
import { parsePushNavigationIntent, type NotificationRow } from '@service-center/shared';
import { toNotificationInsert, toPushMessage } from './notification.model.js';

describe('toNotificationInsert', () => {
  it('fills the optional columns with null rather than leaving them undefined', () => {
    expect(
      toNotificationInsert({
        organizationId: 'org-1',
        userId: 'user-1',
        type: 'assignment_scheduled',
        title: "You're scheduled for Sunday Morning",
      }),
    ).toEqual({
      organization_id: 'org-1',
      user_id: 'user-1',
      type: 'assignment_scheduled',
      title: "You're scheduled for Sunday Morning",
      body: null,
      plan_id: null,
      assignment_id: null,
      created_by: null,
      dedupe_key: null,
      plan_item_id: null,
      operational_message_id: null,
      conversation_id: null,
    });
  });

  it('carries the deep-link ids through', () => {
    const insert = toNotificationInsert({
      organizationId: 'org-1',
      userId: 'user-1',
      type: 'assignment_reminder',
      title: 'Reminder',
      body: 'Worship Band',
      planId: 'plan-1',
      assignmentId: 'assignment-1',
      createdBy: 'user-2',
    });
    expect(insert.plan_id).toBe('plan-1');
    expect(insert.assignment_id).toBe('assignment-1');
    expect(insert.created_by).toBe('user-2');
  });
});

describe('toPushMessage', () => {
  const row: NotificationRow = {
    id: 'notification-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    type: 'assignment_scheduled',
    title: 'Sunday Morning',
    body: null,
    plan_id: 'plan-1',
    assignment_id: 'assignment-1',
    read_at: null,
    created_by: 'user-2',
    created_at: '2026-09-06T10:00:00.000Z',
    dedupe_key: null,
  };

  const pushText = { title: 'Service Center', body: 'Open the app to view a schedule update.' };

  it('keeps private schedule wording off the lock screen', () => {
    const message = toPushMessage(row, 'ExponentPushToken[abc]', 3, pushText);
    expect(message.title).toBe('Service Center');
    expect(message.body).toBe('Open the app to view a schedule update.');
    expect(message.title).not.toContain(row.title);
  });

  it('carries the ids the app needs to deep-link', () => {
    const message = toPushMessage(row, 'ExponentPushToken[abc]', 3, pushText);
    expect(message.to).toBe('ExponentPushToken[abc]');
    expect(message.badge).toBe(3);
    expect(message.data).toEqual({
      notification_id: 'notification-1',
      type: 'assignment_scheduled',
      organization_id: 'org-1',
      plan_id: 'plan-1',
    });
  });
  it.each(['conversation_message', 'conversation_mention', 'conversation_reply'] as const)(
    'produces a mobile-readable %s push without leaking chat content', (type) => {
      const message = toPushMessage({
        ...row,
        id: '11111111-1111-4111-8111-111111111111',
        organization_id: '22222222-2222-4222-8222-222222222222',
        plan_id: null,
        type,
        title: 'Private team name',
        body: 'Private message text',
      }, 'ExponentPushToken[test]', 1, pushText);
      expect(parsePushNavigationIntent(message.data)).toMatchObject({
        status: 'accepted', intent: { kind: 'notifications', notificationType: type },
      });
      expect(JSON.stringify(message)).not.toContain('Private');
    },
  );

});
