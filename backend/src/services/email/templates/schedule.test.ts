import { describe, expect, it } from 'vitest';
import { scheduleEmail } from './schedule.js';
import { serviceReminderEmail } from './service-reminder.js';
import { classifyResendError } from '../resend-transport.js';

const base = {
  to: 'sam@example.test',
  locale: 'en' as const,
  personName: 'Sam',
  planTitle: 'Sunday A',
  serviceDate: '2026-11-01',
  teamName: 'Band',
  positionName: 'Bass',
  respondUrl: 'https://app.test/respond?token=a',
};

describe('scheduleEmail', () => {
  it('lists each plan of a consolidated release with its own link', () => {
    const content = scheduleEmail({
      ...base,
      plans: [
        { planTitle: 'Sunday A', serviceDate: '2026-11-01', assignments: [{ teamName: 'Band', positionName: 'Bass' }], respondUrl: 'https://app.test/respond?token=a' },
        { planTitle: 'Sunday B', serviceDate: '2026-11-08', assignments: [{ teamName: 'Band', positionName: 'Keys' }], respondUrl: 'https://app.test/respond?token=b' },
      ],
    });
    expect(content.subject).toBe("You're scheduled for 2 services");
    expect(content.text).toContain('answering one does not answer the others');
    expect(content.text).toContain('token=a');
    expect(content.text).toContain('token=b');
    expect(content.html.match(/Confirm or decline Sunday/g)).toHaveLength(2);
  });

  it('keeps the single-plan email and words a reminder as one', () => {
    expect(scheduleEmail(base).subject).toBe('Assignment for Sunday A');
    const reminder = scheduleEmail({ ...base, reminder: true });
    expect(reminder.subject).toBe('Reminder: please answer for Sunday A');
    expect(reminder.text).toContain('token=a');
  });

  it('escapes plan titles', () => {
    expect(scheduleEmail({ ...base, planTitle: '<b>x</b>' }).html).not.toContain('<b>x</b>');
  });
});

describe('serviceReminderEmail', () => {
  it('has no response link', () => {
    const content = serviceReminderEmail({
      to: 'm@example.test', locale: 'en', personName: 'Morgan', organizationName: 'Riverside', planTitle: 'Sunday A',
      serviceDate: '2026-11-01', firstTimeAt: '2026-10-31T22:00:00Z', firstTimeLabel: 'Sat, Oct 31, 6:00 PM',
      location: null, assignments: [{ teamName: 'Band', positionName: 'Keys' }], planUrl: 'https://app.test/plans/p',
    });
    expect(content.subject).toBe('Coming up: Sunday A');
    expect(content.text).toContain('Sat, Oct 31, 6:00 PM');
    expect(content.text).not.toContain('respond');
  });
});

describe('classifyResendError', () => {
  it('treats a reused idempotency key with a different body as an uncertain earlier send', () => {
    const error = classifyResendError({ name: 'invalid_idempotent_request', statusCode: 409 });
    expect(error.disposition).toBe('ambiguous');
    expect(error.code).toBe('provider_duplicate_key');
  });
  it('retries while the same key is still in flight', () => {
    expect(classifyResendError({ name: 'concurrent_idempotent_requests', statusCode: 409 }).disposition).toBe('retry');
  });
});
