/**
 * Keyset ("before") cursors for lists ordered by `created_at desc, id desc`.
 *
 * A cursor is either a plain timestamp (the legacy form, which can skip rows
 * that share a timestamp) or `<timestamp>~<row id>`, which cannot.
 */

export interface KeysetCursor {
  created_at: string;
  /** Absent for a legacy timestamp-only cursor. */
  id: string | null;
}

const KEYSET_SEPARATOR = '~';
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeKeysetCursor = (row: { created_at: string; id: string }): string =>
  `${row.created_at}${KEYSET_SEPARATOR}${row.id}`;

/** Returns null when the text is not a valid cursor. */
export const parseKeysetCursor = (cursor: string): KeysetCursor | null => {
  const [created_at = '', id, ...rest] = cursor.split(KEYSET_SEPARATOR);
  if (rest.length > 0 || !CURSOR_TIMESTAMP.test(created_at) || Number.isNaN(Date.parse(created_at))) return null;
  if (id === undefined) return { created_at, id: null };
  return CURSOR_ID.test(id) ? { created_at, id: id.toLowerCase() } : null;
};

/**
 * PostgREST `or=` filter selecting the rows strictly after the cursor in
 * `created_at desc, id desc` order. Timestamps are quoted so the `+` of an
 * offset survives the query string.
 */
export const keysetBeforeFilter = (cursor: KeysetCursor): string =>
  cursor.id === null
    ? `created_at.lt."${cursor.created_at}"`
    : `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`;
