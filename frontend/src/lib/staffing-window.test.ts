import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import {
  DEFAULT_MATRIX_DAYS,
  defaultMatrixFilters,
  isPlanLimitError,
} from './staffing-window';

const filters = defaultMatrixFilters(Date.parse('2026-12-01T00:00:00.000Z'));

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
});
