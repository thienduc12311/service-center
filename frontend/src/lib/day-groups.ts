import { toISODate } from '@service-center/shared';

/** Items that fall on one local calendar day, in the order they were given. */
export interface DayGroup<T> {
  /** The viewer's local date, `YYYY-MM-DD`. */
  day: string;
  items: T[];
}

/**
 * Splits an already-sorted list into runs of the same local day, keeping the
 * order. A day that appears twice (unsorted input) starts a new group rather
 * than reordering anything.
 */
export const groupByDay = <T,>(items: readonly T[], instantOf: (item: T) => string): DayGroup<T>[] => {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = toISODate(instantOf(item));
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
};

/** How a day header reads: relative for the days next to today, otherwise a date. */
export type DayLabelKind = 'today' | 'yesterday' | 'tomorrow' | 'date';

export const dayLabelKind = (day: string, now: Date = new Date()): DayLabelKind => {
  const offset = (delta: number): string => {
    const date = new Date(now);
    date.setDate(date.getDate() + delta);
    return toISODate(date);
  };
  if (day === offset(0)) return 'today';
  if (day === offset(-1)) return 'yesterday';
  if (day === offset(1)) return 'tomorrow';
  return 'date';
};
