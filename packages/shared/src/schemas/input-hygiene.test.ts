import { describe, expect, it } from 'vitest';
import { instantString, isInstantString } from './common.js';
import { createPlanSchema, duplicatePlanSchema, listPlansQuerySchema, planTimeSchema } from './plan.js';
import { createOrganizationSchema, updateOrganizationSchema } from './organization.js';
import { createTeamSchema } from './team.js';
import { staffingMatrixQuerySchema } from './staffing-matrix.js';
import { createTeamRotationSchema } from './staffing-proposals.js';
import { TimeInputError, resolveOneOffBlockout } from '../lib/timezone.js';

/** QA wave 2: caller mistakes are rejected before they reach Postgres. */
describe('instant strings (W2-PLANS-D1)', () => {
  it('accepts the forms clients send', () => {
    for (const value of ['2027-02-14T10:00:00.000Z', '2027-02-14T10:00:00Z', '2027-02-14T10:00:00+07:00',
      '2027-02-14T10:00', '2027-02-14']) {
      expect(isInstantString(value), value).toBe(true);
    }
  });

  it('rejects garbage and calendar-invalid values', () => {
    for (const value of ['not-a-date', '', 'nope', '2027-13-40', '2027-02-30T10:00:00Z', '2027-02-14T25:00:00Z',
      "2027-02-14'; drop table plans; --", '1']) {
      expect(isInstantString(value), value).toBe(false);
      expect(instantString.safeParse(value).success, value).toBe(false);
    }
  });

  it('guards plan create, update times, duplicate and list filters', () => {
    expect(createPlanSchema.safeParse({ title: 'x', service_date: 'not-a-date' }).success).toBe(false);
    expect(createPlanSchema.safeParse({ title: 'x', service_date: '2027-02-14T10:00:00Z' }).success).toBe(true);
    expect(planTimeSchema.safeParse({ starts_at: 'junk', ends_at: '2027-02-14T11:00:00Z' }).success).toBe(false);
    expect(duplicatePlanSchema.safeParse({ service_date: 'junk' }).success).toBe(false);
    expect(listPlansQuerySchema.safeParse({ from: 'garbage' }).success).toBe(false);
    expect(listPlansQuerySchema.safeParse({ to: '2027-02-14T10:00:00.000Z' }).success).toBe(true);
  });
});

describe('organization timezone (API-D4)', () => {
  it('accepts IANA zones and rejects anything else', () => {
    const base = { name: 'Church', slug: 'church' };
    expect(createOrganizationSchema.safeParse({ ...base, timezone: 'America/Chicago' }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ ...base, timezone: 'Not/AZone' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
    expect(updateOrganizationSchema.safeParse({ timezone: 'Asia/Ho_Chi_Minh' }).success).toBe(true);
  });
});

describe('team positions (API-D6)', () => {
  it('rejects duplicate position names on create', () => {
    expect(createTeamSchema.safeParse({ name: 'Band', positions: ['Dup', 'Dup'] }).success).toBe(false);
    expect(createTeamSchema.safeParse({ name: 'Band', positions: ['Keys', 'Drums'] }).success).toBe(true);
  });
});

describe('staffing inputs (W2-STAFF-D4)', () => {
  it('requires a person id as the matrix cursor', () => {
    const filters = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };
    expect(staffingMatrixQuerySchema.safeParse({ filters, cursor: 'garbage' }).success).toBe(false);
    expect(staffingMatrixQuerySchema.safeParse({ filters, cursor: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
  });

  it('rejects calendar-invalid rotation dates', () => {
    const rotation = (anchor: string, exceptionDate = '2027-04-30') => createTeamRotationSchema.safeParse({
      team_id: '00000000-0000-4000-8000-000000000001', name: 'Band', cycle_weeks: 2, anchor_date: anchor,
      exceptions: [{ local_date: exceptionDate, position_id: '00000000-0000-4000-8000-000000000002', person_id: null }],
    }).success;
    expect(rotation('2027-13-40')).toBe(false);
    expect(rotation('2027-02-29')).toBe(false);
    expect(rotation('2028-02-29')).toBe(true);
    expect(rotation('2028-02-29', '2027-04-31')).toBe(false);
  });
});

describe('blockout time errors (W2-AVAIL-D1)', () => {
  it('are TimeInputError so servers answer 400', () => {
    expect(() => resolveOneOffBlockout({
      allDay: false, timeZone: 'America/Toronto', localStartDate: '2027-03-01', localStartTime: '09:00',
      localEndDate: '2027-03-01', localEndTime: '08:00', ambiguousTimePolicy: 'earlier',
    })).toThrow(TimeInputError);
  });
});
