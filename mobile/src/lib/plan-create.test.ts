import { describe, expect, it } from 'vitest';
import { createPlanSchema } from '@service-center/shared';
import { NEW_PLAN_SERVICE_MINUTES, createPlanBody, nextLocalSunday, resolvePlanStart, type NewPlanDraft } from './plan-create';

const TORONTO = 'America/Toronto';

describe('resolvePlanStart', () => {
  it('reads the wall clock in the organization timezone, not the device', () => {
    expect(resolvePlanStart('2026-10-25', '10:00', TORONTO, 'earlier')).toEqual({
      kind: 'resolved', startsAt: '2026-10-25T14:00:00.000Z', repeated: false,
    });
    // Same wall clock after the 2026-11-01 fall-back is an hour later in UTC.
    expect(resolvePlanStart('2026-11-08', '10:00', TORONTO, 'earlier')).toEqual({
      kind: 'resolved', startsAt: '2026-11-08T15:00:00.000Z', repeated: false,
    });
  });

  it('refuses a time skipped by spring forward', () => {
    expect(resolvePlanStart('2027-03-14', '02:30', TORONTO, 'earlier')).toEqual({ kind: 'skipped' });
  });

  it('uses the chosen instant of a repeated fall-back time', () => {
    expect(resolvePlanStart('2026-11-01', '01:30', TORONTO, 'earlier')).toEqual({
      kind: 'resolved', startsAt: '2026-11-01T05:30:00.000Z', repeated: true,
    });
    expect(resolvePlanStart('2026-11-01', '01:30', TORONTO, 'later')).toEqual({
      kind: 'resolved', startsAt: '2026-11-01T06:30:00.000Z', repeated: true,
    });
  });

  it('reports an unusable date or timezone instead of throwing', () => {
    expect(resolvePlanStart('2026-13-40', '10:00', TORONTO, 'earlier')).toEqual({ kind: 'invalid' });
    expect(resolvePlanStart('2026-10-25', '10:00', 'Not/AZone', 'earlier')).toEqual({ kind: 'invalid' });
  });
});

describe('nextLocalSunday', () => {
  it('is the next Sunday in the organization timezone, never today', () => {
    // Saturday 2026-10-24 23:30 in Toronto is already Sunday in UTC.
    expect(nextLocalSunday(new Date('2026-10-25T03:30:00Z'), TORONTO)).toBe('2026-10-25');
    // A Sunday suggests the following one.
    expect(nextLocalSunday(new Date('2026-10-25T15:00:00Z'), TORONTO)).toBe('2026-11-01');
    expect(nextLocalSunday(new Date('2026-10-25T15:00:00Z'), 'Asia/Tokyo')).toBe('2026-11-01');
  });
});

describe('createPlanBody', () => {
  const draft: NewPlanDraft = {
    title: '  Sunday Morning ',
    localDate: '2026-11-08',
    localTime: '10:00',
    serviceTypeId: null,
    location: '  ',
  };

  it('builds a draft plan with one service time, valid for the shared schema', () => {
    const body = createPlanBody(draft, '2026-11-08T15:00:00.000Z', 'Service', 'mobile-create-key-1');
    expect(body).toEqual({
      title: 'Sunday Morning',
      service_date: '2026-11-08T15:00:00.000Z',
      service_type_id: null,
      location: null,
      status: 'draft',
      times: [{ kind: 'service', name: 'Service', starts_at: '2026-11-08T15:00:00.000Z', ends_at: '2026-11-08T16:30:00.000Z' }],
      idempotency_key: 'mobile-create-key-1',
    });
    expect(NEW_PLAN_SERVICE_MINUTES).toBe(90);
    const parsed = createPlanSchema.parse(body);
    // Nothing is copied from another plan, so no confirmations or roster come along.
    expect(parsed.copy_from_plan_id).toBeUndefined();
    expect(parsed.copy_assignments).toBe(false);
  });

  it('is refused by the shared schema without a title', () => {
    const body = createPlanBody({ ...draft, title: '   ' }, '2026-11-08T15:00:00.000Z', 'Service', 'mobile-create-key-1');
    expect(createPlanSchema.safeParse(body).success).toBe(false);
  });
});
