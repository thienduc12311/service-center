import { keysetBeforeFilter, parseKeysetCursor, type PeopleCursor } from '@service-center/shared';
import { HttpError } from './errors.js';

/** PostgREST `or=` filter for the page after a validated `before` cursor. */
export const beforeFilter = (cursor: string): string => {
  const parsed = parseKeysetCursor(cursor);
  if (!parsed) throw HttpError.badRequest('Invalid cursor');
  return keysetBeforeFilter(parsed);
};

/** Quotes a value for a PostgREST `or=` filter: commas, parens and quotes stay data. */
export const quoteFilterValue = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Which side of a People cursor a page reads. */
export type PeopleKeysetSide = 'after' | 'before';

/**
 * PostgREST `or=` filter for the People rows strictly after (or before) a
 * cursor in `sort_name, id` order.
 */
export const peopleKeysetFilter = (cursor: PeopleCursor, side: PeopleKeysetSide): string => {
  const op = side === 'after' ? 'gt' : 'lt';
  const name = quoteFilterValue(cursor.sort_name);
  return `sort_name.${op}.${name},and(sort_name.eq.${name},id.${op}.${cursor.id})`;
};
