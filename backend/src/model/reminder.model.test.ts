import { describe, expect, it } from 'vitest';
import type { PlanTimeRow, ReminderJobRow } from '@service-center/shared';
import { groupReleaseRecipients, releaseChannels, toPlanReminderJob, type ReleaseCandidateRow } from './reminder.model.js';

const row = (id: string, personId: string, planId: string, serviceDate: string, title = planId): ReleaseCandidateRow => ({
  id,
  plan_id: planId,
  person_id: personId,
  request_revision: 3,
  team: { name: 'Band' },
  position: { name: id },
  plan: { title, service_date: serviceDate },
});

describe('groupReleaseRecipients', () => {
  it('gives one message per Person with a separate, date-ordered section per plan', () => {
    const rows = [
      row('bass', 'sam', 'late', '2026-11-08T15:00:00Z'),
      row('guitar', 'sam', 'early', '2026-11-01T15:00:00Z'),
      row('keys', 'sam', 'early', '2026-11-01T15:00:00Z'),
      row('drums', 'riley', 'early', '2026-11-01T15:00:00Z'),
    ];
    const recipients = groupReleaseRecipients(
      rows,
      new Map([['sam', 'Sam Rivera'], ['riley', 'Riley Chen']]),
      new Map([
        ['sam', { person_id: 'sam', has_login: true, has_email: true, active: true }],
        ['riley', { person_id: 'riley', has_login: true, has_email: false, active: true }],
      ]),
      new Map(),
    );
    expect(recipients.map((r) => r.person_name)).toEqual(['Riley Chen', 'Sam Rivera']);
    const sam = recipients[1]!;
    expect(sam.plans.map((p) => p.plan_id)).toEqual(['early', 'late']);
    expect(sam.plans[0]!.assignments.map((a) => a.assignment_id)).toEqual(['guitar', 'keys']);
    expect(sam.plans[1]!.assignments.map((a) => a.assignment_id)).toEqual(['bass']);
    expect(recipients[0]!.skipped).toEqual(['no_email_address']);
  });

  it('carries resolved times per request', () => {
    const time = { id: 't1', plan_id: 'p' } as PlanTimeRow;
    const [recipient] = groupReleaseRecipients(
      [row('a', 'sam', 'p', '2026-11-01T15:00:00Z')], new Map(), new Map(),
      new Map([['a', { times: [time], untimed: false }]]),
    );
    expect(recipient!.plans[0]!.assignments[0]!.times).toEqual([time]);
  });
});

describe('releaseChannels', () => {
  it('explains skipped channels for a no-login guest without email', () => {
    const { channels, skipped } = releaseChannels({ person_id: 'g', has_login: false, has_email: false, active: true });
    expect(channels).toEqual({ email: false, in_app: false, push: false });
    expect(skipped).toEqual(['no_email_address', 'no_login']);
  });
  it('flags an inactive member', () => {
    expect(releaseChannels({ person_id: 'm', has_login: true, has_email: true, active: false }).skipped)
      .toContain('recipient_not_eligible');
  });
});

describe('toPlanReminderJob', () => {
  it('maps a job and labels default vs explicit policy', () => {
    const job = {
      id: 'j', person_id: 'sam', kind: 'pending_response', channel: 'email', status: 'scheduled', status_reason: null,
      due_at: '2026-10-29T15:00:00Z', occurrence_starts_at: '2026-11-01T15:00:00Z', policy_id: null,
    } as ReminderJobRow;
    expect(toPlanReminderJob(job, new Map([['sam', 'Sam']]))).toMatchObject({ person_name: 'Sam', policy_source: 'default' });
    expect(toPlanReminderJob({ ...job, policy_id: 'p' }, new Map()).policy_source).toBe('policy');
  });
});
