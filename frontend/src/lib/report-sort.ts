import type { ReportCellValue } from './report-print';

export type SortDirection = 'asc' | 'desc';

/** Which column the report table is sorted by; null keeps the server's order. */
export interface ReportSort {
  column: number;
  direction: SortDirection;
}

/**
 * Compares two raw cells (before display formatting): numbers numerically,
 * ISO dates and text in the viewer's collation, booleans false-first. Empty
 * cells always sort last, whatever the direction.
 */
const compareCells = (a: ReportCellValue, b: ReportCellValue, collator: Intl.Collator): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
};

const isEmpty = (value: ReportCellValue | undefined): boolean => value === null || value === undefined || value === '';

/**
 * Row indexes of `raw` in the requested order. Ties keep the server's order,
 * so sorting by team keeps each team's rows by date.
 */
export const sortedRowOrder = (
  raw: readonly (readonly ReportCellValue[])[],
  sort: ReportSort | null,
  locale: string,
): number[] => {
  const order = raw.map((_, index) => index);
  if (!sort) return order;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const factor = sort.direction === 'asc' ? 1 : -1;
  return order.sort((left, right) => {
    const a = raw[left]?.[sort.column] ?? null;
    const b = raw[right]?.[sort.column] ?? null;
    if (isEmpty(a) || isEmpty(b)) {
      if (isEmpty(a) && isEmpty(b)) return left - right;
      return isEmpty(a) ? 1 : -1;
    }
    return compareCells(a, b, collator) * factor || left - right;
  });
};

/** Clicking a heading: a new column sorts ascending, the same column flips, a third click restores the server order. */
export const nextReportSort = (current: ReportSort | null, column: number): ReportSort | null => {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  return current.direction === 'asc' ? { column, direction: 'desc' } : null;
};
