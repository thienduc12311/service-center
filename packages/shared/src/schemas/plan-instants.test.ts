import { describe, expect, it } from 'vitest';
import { zonedInstantString } from './common.js';
import { createPlanSchema, duplicatePlanSchema, planTimeSchema, updatePlanSchema } from './plan.js';

/** W10-CD-D2: a stored plan instant must carry its offset; nothing is guessed as UTC. */
describe('plan instants need an offset (W10-CD-D2)', () => {
  it('accepts UTC and explicit offsets', () => {
    for (const value of ['2040-08-04T10:00:00Z', '2040-08-04T10:00:00.000Z', '2040-08-04T10:00:00-05:00',
      '2040-08-04T10:00+0700', '2040-08-04 10:00:00+07:00']) {
      expect(zonedInstantString.safeParse(value).success, value).toBe(true);
    }
  });

  it('refuses date-only and zone-less values with a message asking for the offset', () => {
    for (const value of ['2040-08-04', '2040-08-18T10:00:00', '2040-08-18T10:00', '2040-08-18 10:00:00']) {
      const result = zonedInstantString.safeParse(value);
      expect(result.success, value).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('UTC offset');
    }
  });

  it('applies to plan create, update, duplicate and every plan time', () => {
    expect(createPlanSchema.safeParse({ title: 'x', service_date: '2040-08-04' }).success).toBe(false);
    expect(createPlanSchema.safeParse({ title: 'x', service_date: '2040-08-04T10:00:00-05:00' }).success).toBe(true);
    expect(updatePlanSchema.safeParse({ service_date: '2040-08-18T10:00:00' }).success).toBe(false);
    expect(duplicatePlanSchema.safeParse({ service_date: '2040-08-04' }).success).toBe(false);
    expect(planTimeSchema.safeParse({ starts_at: '2040-08-18T10:00:00', ends_at: '2040-08-18T11:00:00Z' }).success).toBe(false);
    expect(planTimeSchema.safeParse({ starts_at: '2040-08-18T10:00:00Z', ends_at: '2040-08-18T11:00:00' }).success).toBe(false);
    expect(planTimeSchema.safeParse({ starts_at: '2040-08-18T10:00:00-05:00', ends_at: '2040-08-18T11:00:00-05:00' }).success).toBe(true);
  });
});
