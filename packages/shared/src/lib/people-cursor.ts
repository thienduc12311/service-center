import { base64UrlDecode, base64UrlEncode } from './base64url.js';

/**
 * Keyset cursor for the People list, ordered by `sort_name asc, id asc`
 * (`sort_name` is the lower-cased "first last" the database stores on `people`).
 * Format: base64url of the JSON tuple `[sort_name, id]`. Compact for any
 * script: a URL-encoded Thai or Vietnamese name grew up to 9 characters per
 * letter and outran the query limit, so "Load more" failed forever.
 */
export interface PeopleCursor {
  sort_name: string;
  id: string;
}

/**
 * Longest cursor the API accepts. Worst case: a 161-unit `sort_name` (80 +
 * space + 80) of characters JSON escapes as `\u00XX` (6 bytes each) = 966
 * bytes, plus the uuid and punctuation (43) = 1009 bytes → 1348 base64url
 * characters.
 */
export const PEOPLE_CURSOR_MAX = 1400;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The JSON tuple inside a cursor. */
type PeopleCursorTuple = [sort_name: string, id: string];

export const encodePeopleCursor = (row: PeopleCursor): string => {
  const tuple: PeopleCursorTuple = [row.sort_name, row.id.toLowerCase()];
  return base64UrlEncode(JSON.stringify(tuple));
};

const isCursorTuple = (value: unknown): value is PeopleCursorTuple =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string' && UUID.test(value[1]);

/** Returns null when the text is not a cursor this module issued. */
export const decodePeopleCursor = (cursor: string): PeopleCursor | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(cursor));
  } catch {
    // Not base64url, not UTF-8 or not JSON: not one of ours (the API answers 400).
    return null;
  }
  return isCursorTuple(parsed) ? { sort_name: parsed[0], id: parsed[1].toLowerCase() } : null;
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
