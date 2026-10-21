import { describe, expect, it } from 'vitest';
import { createReleaseBatchSchema, upsertReminderPolicySchema } from '../schemas/reminders.js';
import {
  formatReminderOffset,
  isPolicySetAtScope,
  planDeliveryByPerson,
  reminderPolicyDraftFrom,
  reminderPolicyRequest,
  reminderReasonLabel,
  releaseFailureLabel,
  toWallClockInput,
  validateReminderPolicyDraft,
} from './reminders.js';

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

describe('reminder policy draft (MOB-015, shared by web and native)', () => {
  const effective = {
    kind: 'confirmed_service',
    policy_id: id(5),
    source: 'service_type',
    revision: 3,
    enabled: true,
    offset_minutes: 1440,
    channels: ['email', 'in_app'],
    quiet_start: '22:00:00',
    quiet_end: '07:00:00',
    max_per_day: 2,
  } as const;

  it('starts from the policy in effect, in hours and HH:MM', () => {
    expect(reminderPolicyDraftFrom({ ...effective, channels: [...effective.channels] })).toEqual({
      enabled: true, hours: '24', channels: ['email', 'in_app'], quiet: true, quietStart: '22:00', quietEnd: '07:00', maxPerDay: 2,
    });
  });

  it('builds a valid override with the loaded revision and canonical channel order', () => {
    const draft = { ...reminderPolicyDraftFrom({ ...effective, channels: [...effective.channels] }), hours: '1.5' };
    const body = reminderPolicyRequest(draft, 'confirmed_service', { serviceTypeId: id(9) }, { revision: 3 });
    expect(body).toMatchObject({ service_type_id: id(9), team_id: null, offset_minutes: 90, channels: ['in_app', 'email'], expected_revision: 3 });
    expect(upsertReminderPolicySchema.safeParse(body).success).toBe(true);
  });

  it('a first override at a scope has no revision; disabling keeps the rest', () => {
    const draft = { ...reminderPolicyDraftFrom({ ...effective, channels: [...effective.channels] }), enabled: false, quiet: false };
    const body = reminderPolicyRequest(draft, 'confirmed_service', { teamId: id(2) }, undefined);
    expect(body).not.toHaveProperty('expected_revision');
    expect(body).toMatchObject({ enabled: false, team_id: id(2), service_type_id: null, quiet_start: null, quiet_end: null });
    expect(upsertReminderPolicySchema.safeParse(body).success).toBe(true);
  });

  it('reports the same problems the schema refuses', () => {
    const draft = reminderPolicyDraftFrom({ ...effective, channels: [...effective.channels] });
    expect(validateReminderPolicyDraft(draft)).toEqual([]);
    expect(validateReminderPolicyDraft({ ...draft, hours: '0.1' })).toEqual(['offset']);
    expect(validateReminderPolicyDraft({ ...draft, hours: '' })).toEqual(['offset']);
    expect(validateReminderPolicyDraft({ ...draft, hours: '721' })).toEqual(['offset']);
    expect(validateReminderPolicyDraft({ ...draft, quietEnd: '22:00' })).toEqual(['quiet']);
    expect(validateReminderPolicyDraft({ ...draft, channels: [] })).toEqual(['channels']);
    expect(validateReminderPolicyDraft({ ...draft, maxPerDay: 11 })).toEqual(['max_per_day']);
    for (const bad of [{ ...draft, hours: '0.1' }, { ...draft, quietEnd: '22:00' }, { ...draft, channels: [] }, { ...draft, maxPerDay: 11 }]) {
      expect(upsertReminderPolicySchema.safeParse(reminderPolicyRequest(bad, 'pending_response', {}, undefined)).success).toBe(false);
    }
  });
});

describe('planDeliveryByPerson', () => {
  const job = (n: number, person: number, name: string, status: 'scheduled' | 'cancelled' | 'skipped') => ({
    id: id(300 + n), person_id: id(person), person_name: name, kind: 'pending_response' as const, channel: 'email' as const,
    status, status_reason: status === 'skipped' ? 'due_passed' : null, due_at: '2027-06-03T14:00:00.000Z',
    occurrence_starts_at: '2027-06-06T14:00:00.000Z', policy_source: 'default' as const,
  });
  const delivery = (n: number, person: number, name: string) => ({
    id: id(400 + n), person_id: id(person), person_name: name, channel: 'in_app' as const, status: 'delivered' as const,
    template: 'assignment_request' as const, error_code: null, attempts: 1, created_at: '2027-06-01T00:00:00.000Z',
    accepted_at: null, completed_at: null, next_attempt_at: null, retryable: false, can_retry: false,
  });

  it('groups by Person, sorted by name, without cancelled intents', () => {
    const grouped = planDeliveryByPerson({
      reminders: [job(1, 2, 'Sam', 'scheduled'), job(2, 2, 'Sam', 'cancelled'), job(3, 3, 'Ana', 'skipped'), job(4, 4, 'Zed', 'cancelled')],
      deliveries: [delivery(1, 2, 'Sam')],
    });
    expect(grouped.map((p) => [p.name, p.reminders.map((r) => r.status), p.deliveries.length])).toEqual([
      ['Ana', ['skipped'], 0],
      ['Sam', ['scheduled'], 1],
    ]);
    expect(planDeliveryByPerson(undefined)).toEqual([]);
  });
});
