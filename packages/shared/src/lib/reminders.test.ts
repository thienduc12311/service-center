import { describe, expect, it } from 'vitest';
import { createReleaseBatchSchema, upsertReminderPolicySchema } from '../schemas/reminders.js';
import { formatReminderOffset, isPolicySetAtScope, reminderReasonLabel, releaseFailureLabel, toWallClockInput } from './reminders.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('formatReminderOffset', () => {
  it('describes the default offsets', () => {
    expect(formatReminderOffset(4320)).toBe('3 days');
    expect(formatReminderOffset(1440)).toBe('1 day');
  });
  it('combines units', () => {
    expect(formatReminderOffset(1565)).toBe('1 day 2 hours 5 minutes');
    expect(formatReminderOffset(45)).toBe('45 minutes');
  });
});

describe('labels', () => {
  it('maps known codes and passes unknown ones through', () => {
    expect(reminderReasonLabel('frequency_cap')).toMatch(/limit/);
    expect(reminderReasonLabel('something_new')).toBe('something_new');
    expect(reminderReasonLabel(null)).toBeNull();
    expect(releaseFailureLabel('scope_changed')).toMatch(/nothing was released/);
  });
  it('trims seconds for time inputs', () => {
    expect(toWallClockInput('22:00:00')).toBe('22:00');
    expect(toWallClockInput(null)).toBe('');
  });
});

describe('upsertReminderPolicySchema', () => {
  const base = { kind: 'pending_response', enabled: true, offset_minutes: 4320, channels: ['email'] } as const;

  it('accepts a policy with quiet hours that cross midnight', () => {
    const parsed = upsertReminderPolicySchema.parse({ ...base, quiet_start: '22:00', quiet_end: '07:30' });
    expect(parsed.max_per_day).toBe(2);
  });
  it('refuses half-set or zero-length quiet hours', () => {
    expect(upsertReminderPolicySchema.safeParse({ ...base, quiet_start: '22:00', quiet_end: null }).success).toBe(false);
    expect(upsertReminderPolicySchema.safeParse({ ...base, quiet_start: '22:00', quiet_end: '22:00:00' }).success).toBe(false);
  });
  it('refuses two scopes, duplicate channels and out-of-range offsets', () => {
    expect(upsertReminderPolicySchema.safeParse({ ...base, service_type_id: id(1), team_id: id(2) }).success).toBe(false);
    expect(upsertReminderPolicySchema.safeParse({ ...base, channels: ['email', 'email'] }).success).toBe(false);
    expect(upsertReminderPolicySchema.safeParse({ ...base, offset_minutes: 5 }).success).toBe(false);
  });
});

describe('createReleaseBatchSchema', () => {
  const item = { assignment_id: id(1), request_revision: 2 };
  it('requires a key and unique reviewed requests', () => {
    expect(createReleaseBatchSchema.safeParse({ items: [item] }).success).toBe(false);
    expect(createReleaseBatchSchema.safeParse({ items: [item, item], idempotency_key: 'release-key-1' }).success).toBe(false);
    expect(createReleaseBatchSchema.parse({ items: [item], idempotency_key: 'release-key-1' }).notify).toBe(true);
  });
  it('refuses schedules more than a year out', () => {
    const later = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
    expect(createReleaseBatchSchema.safeParse({ items: [item], idempotency_key: 'release-key-1', scheduled_for: later }).success)
      .toBe(false);
  });
});

describe('isPolicySetAtScope', () => {
  it('distinguishes a policy set here from an inherited one', () => {
    expect(isPolicySetAtScope('service_type', { serviceTypeId: 'st' })).toBe(true);
    expect(isPolicySetAtScope('organization', { serviceTypeId: 'st' })).toBe(false);
    expect(isPolicySetAtScope('team', { teamId: 't' })).toBe(true);
    expect(isPolicySetAtScope('organization', {})).toBe(true);
    expect(isPolicySetAtScope('default', {})).toBe(false);
  });
});
