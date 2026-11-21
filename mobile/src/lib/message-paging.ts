import { encodeKeysetCursor, type OperationalMessageSummary } from '@service-center/shared';

/** Messages per page (the API's default; the server caps at 100). */
export const MESSAGE_PAGE_SIZE = 30;

/**
 * The `before` cursor for the page after `page`, or undefined when `page` was
 * the last one (fewer rows than asked for). Lists are newest first, so the
 * cursor is the oldest row shown.
 */
export const nextMessagesCursor = (
  page: readonly Pick<OperationalMessageSummary, 'id' | 'created_at'>[],
  limit: number = MESSAGE_PAGE_SIZE,
): string | undefined => {
  const last = page[page.length - 1];
  if (!last || page.length < limit) return undefined;
  return encodeKeysetCursor({ created_at: last.created_at, id: last.id });
};

/** Pages in order, without a row twice (a message sent between page reads can shift one). */
export const flattenMessagePages = <T extends Pick<OperationalMessageSummary, 'id'>>(pages: readonly (readonly T[])[]): T[] => {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }
  return rows;
};
