import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { updateReminderPreferencesSchema, type ReminderPreferences } from '@service-center/shared';
import {
  badgeCountFor,
  badgeSync,
  noReminderChannels,
  parseBadgePreference,
  pushRemindersMissThisDevice,
  pushStatus,
  reminderPreferencesInput,
  type PushPermissionSnapshot,
} from './notification-settings';

const device: PushPermissionSnapshot = { isDevice: true, pushConfigured: true, status: 'granted', canAskAgain: true };
const preferences: ReminderPreferences = { person_id: 'person', email: true, push: true, in_app: true };

describe('MOB-020 badge', () => {
  it('shows the account-wide count the push dispatcher sends, not the active organization', () => {
    expect(badgeCountFor('unread', { unread: 1, account_unread: 5 })).toBe(5);
  });

  it('shows nothing when off, before the count loads, or for a bad count', () => {
    expect(badgeCountFor('off', { unread: 1, account_unread: 5 })).toBe(0);
    expect(badgeCountFor('unread', undefined)).toBe(0);
    expect(badgeCountFor('unread', { unread: 0, account_unread: -1 })).toBe(0);
  });

  it('defaults unknown stored values to the count (the pre-MOB-020 behaviour)', () => {
    expect(parseBadgePreference(null)).toBe('unread');
    expect(parseBadgePreference('garbage')).toBe('unread');
    expect(parseBadgePreference('off')).toBe('off');
  });

  it('reports whether pushes already follow the choice', () => {
    expect(badgeSync('off', false)).toBe('saved');
    expect(badgeSync('unread', true)).toBe('saved');
    expect(badgeSync('off', true)).toBe('pending');
    expect(badgeSync('unread', false)).toBe('pending');
    expect(badgeSync('off', null)).toBe('deviceOnly');
  });
});

describe('MOB-020 OS permission', () => {
  it('distinguishes never asked, refused and unavailable', () => {
    expect(pushStatus({ ...device, status: 'granted' })).toEqual({ state: 'granted', recovery: 'none' });
    expect(pushStatus({ ...device, status: 'undetermined' })).toEqual({ state: 'undetermined', recovery: 'request' });
    expect(pushStatus({ ...device, status: 'denied', canAskAgain: false })).toEqual({ state: 'denied', recovery: 'openSettings' });
    // Android before the first prompt.
    expect(pushStatus({ ...device, status: 'denied', canAskAgain: true })).toEqual({ state: 'undetermined', recovery: 'request' });
    expect(pushStatus({ ...device, isDevice: false })).toEqual({ state: 'unavailable', recovery: 'none' });
    expect(pushStatus({ ...device, pushConfigured: false, status: 'denied', canAskAgain: false }))
      .toEqual({ state: 'unavailable', recovery: 'none' });
  });

  it('offers nothing before the first read (no flash of a recovery button)', () => {
    expect(pushStatus(null).recovery).toBe('none');
  });
});

describe('MOB-020 reminder channels (F08)', () => {
  it('sends the full body the website sends, valid for the shared schema', () => {
    const input = reminderPreferencesInput(preferences, 'push', false);
    expect(input).toEqual({ email: true, push: false, in_app: true });
    expect(updateReminderPreferencesSchema.parse(input)).toEqual(input);
  });

  it('warns when every channel is off and when push reminders miss this device', () => {
    expect(noReminderChannels({ ...preferences, email: false, push: false, in_app: false })).toBe(true);
    expect(noReminderChannels(preferences)).toBe(false);
    expect(pushRemindersMissThisDevice(preferences, false)).toBe(true);
    expect(pushRemindersMissThisDevice(preferences, true)).toBe(false);
    expect(pushRemindersMissThisDevice({ ...preferences, push: false }, false)).toBe(false);
  });
});

describe('MOB-020 notification settings (source contract)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const screen = read('app', 'notification-settings.tsx');
  const provider = read('src', 'providers', 'NotificationsProvider.tsx');

  it('persists through the website methods and reads back the chat list query', () => {
    expect(screen).toContain('api.myReminderPreferences()');
    expect(screen).toContain('api.updateMyReminderPreferences(input)');
    expect(screen).toContain('api.muteConversation(id, muted)');
    expect(screen).toContain('queryKeys.conversationList(queryScope)');
  });

  it('never prompts for permission when only the badge changes', () => {
    const setBadge = provider.slice(provider.indexOf('const setBadgePreference'), provider.indexOf('const enablePush'));
    expect(setBadge).toContain("registration.getState().pushEnabled");
  });

  it('sends the badge choice with every registration and uses the account-wide count', () => {
    expect(provider).toContain("registerForPushNotifications(badgePreferenceRef.current === 'unread')");
    expect(provider).toContain('badgeCountFor(badgePreference, unreadQuery.data)');
  });

  it('does not offer per-event or Live subscriptions without a shared contract', () => {
    expect(screen).not.toMatch(/live_run|subscribeLive|eventPreferences/i);
  });
});
