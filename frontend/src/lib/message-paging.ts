import { encodeKeysetCursor, type KeysetRow } from '@service-center/shared';

/** Operational messages per page on the Messages screen (the server allows 1–100). */
export const MESSAGES_PAGE_SIZE = 30;

/**
 * The `before` cursor for the page after `page`, or undefined when `page` was
 * the last one. The list endpoint returns a bare array, newest first: a short
 * page means nothing older is left.
 */
export const nextMessagesCursor = (page: readonly KeysetRow[], pageSize: number = MESSAGES_PAGE_SIZE): string | undefined => {
  const oldest = page.at(-1);
  return page.length < pageSize || !oldest ? undefined : encodeKeysetCursor(oldest);
};
