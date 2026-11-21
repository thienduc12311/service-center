/** One run of a grouped list: the shared key and the items under it, in list order. */
export interface ListGroup<T> {
  key: string;
  items: T[];
}

/**
 * Groups a list by a key, keeping groups in the order their first item
 * appears and items in their original order — so an already-sorted list
 * (plans by date, teams by sort order) gets section headers without being
 * re-sorted.
 */
export const groupBy = <T,>(items: readonly T[], keyOf: (item: T) => string): ListGroup<T>[] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups].map(([key, groupItems]) => ({ key, items: groupItems }));
};

/** "2026-11": the viewer's local year and month of an instant, for month section headers. */
export const localMonthKey = (instant: string): string => {
  const date = new Date(instant);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
