import { describe, expect, it } from 'vitest';
import { commitStaffingMatrixSchema, staffingMatrixQuerySchema } from './staffing-matrix.js';

const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('staffing matrix schemas', () => {
  it('bounds a matrix to twelve explicit plans and fifty people', () => {
    const filters = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z',
      plan_ids: Array.from({ length: 12 }, (_, index) => id(index + 1)) };
    expect(staffingMatrixQuerySchema.parse({ filters, page_size: 50 }).filters.plan_ids).toHaveLength(12);
    expect(staffingMatrixQuerySchema.safeParse({ filters: { ...filters, plan_ids: [...filters.plan_ids, id(13)] } }).success).toBe(false);
    expect(staffingMatrixQuerySchema.safeParse({ filters, page_size: 51 }).success).toBe(false);
  });

  it('requires an exact reviewed copy revision and destination time scope', () => {
    const result = commitStaffingMatrixSchema.safeParse({
      operation_id: 'a'.repeat(64),
      idempotency_key: 'matrix-test-key',
      base_revisions: [{ plan_id: id(1), staffing_revision: 2 }],
      actions: [{ kind: 'copy', source_assignment_id: id(2), expected_source_revision: 4,
        destination_plan_id: id(1), destination_attendance_mode: 'selected', destination_time_ids: [],
        visibility: 'prepared', notify: false }],
    });
    expect(result.success).toBe(false);
  });
});
