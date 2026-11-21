import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import {
  DEFAULT_MATRIX_DAYS,
  defaultMatrixFilters,
  fitPlanLimit,
  isPlanLimitError,
  nextPlanWindow,
  type PlanWindowEntry,
} from './staffing-window';

const filters = defaultMatrixFilters(Date.parse('2026-12-01T00:00:00.000Z'));

/** `count` plans, one a day from Dec 1 at 09:00 UTC. */
const daily = (count: number): PlanWindowEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `plan-${index + 1}`,
    service_date: new Date(Date.UTC(2026, 11, 1 + index, 9)).toISOString(),
  }));

describe('staffing matrix plan window', () => {
  it('defaults to four weeks from now', () => {
    expect(Date.parse(filters.to) - Date.parse(filters.from)).toBe(DEFAULT_MATRIX_DAYS * 86_400_000);
    expect(filters.plan_ids).toEqual([]);
  });

  it('recognises the server refusing more than 12 plans, and nothing else', () => {
    expect(isPlanLimitError(new ApiError(400, 'Narrow the filters to 12 plans or fewer', 'bad_request'))).toBe(true);
    expect(isPlanLimitError(new ApiError(400, 'Something else', 'matrix_plan_limit'))).toBe(true);
    expect(isPlanLimitError(new ApiError(400, 'The end of the matrix range must be after the start', 'validation_failed'))).toBe(false);
    expect(isPlanLimitError(new ApiError(500, 'Narrow the filters to 12 plans or fewer'))).toBe(false);
    expect(isPlanLimitError(new Error('Narrow the filters to 12 plans or fewer'))).toBe(false);
  });

  it('leaves a range that already fits untouched', () => {
    expect(fitPlanLimit(filters, daily(12))).toBe(filters);
  });

  it('ends the range at the 12th plan when there are more', () => {
    const plans = daily(13);
    const fitted = fitPlanLimit(filters, plans);
    expect(fitted.to).toBe(plans[11]!.service_date);
    expect(fitted.from).toBe(filters.from);
    expect(fitted.plan_ids).toEqual([]);
  });

  it('steps back when the 13th plan shares the 12th plan\'s time', () => {
    const plans = daily(12);
    plans.push({ id: 'plan-13', service_date: plans[11]!.service_date });
    const fitted = fitPlanLimit(filters, plans);
    expect(fitted.to).toBe(plans[10]!.service_date);
  });

  it('pins the first 12 plans by id when no date boundary fits', () => {
    const same = Array.from({ length: 13 }, (_, index) => ({ id: `plan-${index + 1}`, service_date: '2026-12-06T09:00:00.000Z' }));
    const fitted = fitPlanLimit(filters, same);
    expect(fitted.plan_ids).toEqual(same.slice(0, 12).map((plan) => plan.id));
    expect(fitted.to).toBe(filters.to);
  });

  it('moves on to the plans after the last one shown, up to the requested end', () => {
    const next = nextPlanWindow({ ...filters, plan_ids: ['plan-1'] }, '2026-12-12T09:00:00.000Z', '2027-01-31T23:59:59.999Z');
    expect(next.from).toBe('2026-12-12T09:00:00.001Z');
    expect(next.to).toBe('2027-01-31T23:59:59.999Z');
    expect(next.plan_ids).toEqual([]);
  });

  it('opens another default window when the requested end is already behind', () => {
    const next = nextPlanWindow(filters, '2026-12-12T09:00:00.000Z', '2026-12-10T00:00:00.000Z');
    expect(Date.parse(next.to) - Date.parse(next.from)).toBe(DEFAULT_MATRIX_DAYS * 86_400_000);
  });
});
