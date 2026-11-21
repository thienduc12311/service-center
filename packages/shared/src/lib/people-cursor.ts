/**
 * Keyset cursor for the People list, ordered by `sort_name asc, id asc`
 * (`sort_name` is the lower-cased "first last" the database stores on `people`).
 * Format: `<encodeURIComponent(sort_name)>~<id>`; `~` is never produced by
 * encodeURIComponent for the id, which is a uuid, so the last `~` splits it.
 */
export interface PeopleCursor {
  sort_name: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodePeopleCursor = (row: PeopleCursor): string => `${encodeURIComponent(row.sort_name)}~${row.id.toLowerCase()}`;

/** Returns null when the text is not a cursor this module issued. */
export const decodePeopleCursor = (cursor: string): PeopleCursor | null => {
  const split = cursor.lastIndexOf('~');
  if (split < 0) return null;
  const id = cursor.slice(split + 1);
  if (!UUID.test(id)) return null;
  try {
    return { sort_name: decodeURIComponent(cursor.slice(0, split)), id: id.toLowerCase() };
  } catch {
    return null;
  }
};

/** Flattens loaded infinite-query pages, dropping a row repeated across pages (a person edited mid-scroll). */
export const flattenPeoplePages = <T extends { id: string }>(pages: ReadonlyArray<{ items: readonly T[] }>): T[] => {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
    }
  }
  return rows;
};
