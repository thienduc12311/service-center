import { describe, expect, it } from 'vitest';
import { nextReportSort, sortedRowOrder } from './report-sort';
import type { ReportCellValue } from './report-print';

const rows: ReportCellValue[][] = [
  ['2026-12-06', 'Band', 10, null],
  ['2026-11-29', 'Ánh sáng', 2, 'yes'],
  ['2026-12-13', 'band', 2, 'no'],
];

describe('report column sort', () => {
  it('keeps the server order when unsorted', () => {
    expect(sortedRowOrder(rows, null, 'en')).toEqual([0, 1, 2]);
  });

  it('sorts numbers numerically and keeps ties in server order', () => {
    expect(sortedRowOrder(rows, { column: 2, direction: 'asc' }, 'en')).toEqual([1, 2, 0]);
    expect(sortedRowOrder(rows, { column: 2, direction: 'desc' }, 'en')).toEqual([0, 1, 2]);
  });

  it('sorts ISO dates and text in the viewer\'s collation', () => {
    expect(sortedRowOrder(rows, { column: 0, direction: 'asc' }, 'en')).toEqual([1, 0, 2]);
    expect(sortedRowOrder(rows, { column: 1, direction: 'asc' }, 'vi')).toEqual([1, 0, 2]);
  });

  it('puts empty cells last in both directions', () => {
    expect(sortedRowOrder(rows, { column: 3, direction: 'asc' }, 'en').at(-1)).toBe(0);
    expect(sortedRowOrder(rows, { column: 3, direction: 'desc' }, 'en').at(-1)).toBe(0);
  });

  it('cycles ascending, descending, then the server order', () => {
    const first = nextReportSort(null, 1);
    expect(first).toEqual({ column: 1, direction: 'asc' });
    const second = nextReportSort(first, 1);
    expect(second).toEqual({ column: 1, direction: 'desc' });
    expect(nextReportSort(second, 1)).toBeNull();
    expect(nextReportSort(second, 2)).toEqual({ column: 2, direction: 'asc' });
  });
});
