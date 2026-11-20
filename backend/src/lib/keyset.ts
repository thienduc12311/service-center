import { keysetBeforeFilter, parseKeysetCursor } from '@service-center/shared';
import { HttpError } from './errors.js';

/** PostgREST `or=` filter for the page after a validated `before` cursor. */
export const beforeFilter = (cursor: string): string => {
  const parsed = parseKeysetCursor(cursor);
  if (!parsed) throw HttpError.badRequest('Invalid cursor');
  return keysetBeforeFilter(parsed);
};
