import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.js';

/** A NUL byte, or a UTF-16 surrogate that is not half of a valid pair. */
const UNSUPPORTED_TEXT = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const MAX_DEPTH = 32;

/** Whether any string (or object key) inside a parsed JSON/query value is unsupported by Postgres. */
export const containsUnsupportedText = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'string') return UNSUPPORTED_TEXT.test(value);
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value)) return value.some((item) => containsUnsupportedText(item, depth + 1));
  return Object.entries(value).some(
    ([key, item]) => UNSUPPORTED_TEXT.test(key) || containsUnsupportedText(item, depth + 1),
  );
};

/**
 * Postgres text cannot hold NUL, and PostgREST cannot carry a lone surrogate;
 * both used to surface as a 500 with the raw database error (W7-ACC-D5,
 * W7-MSG-D11). Reject them up front, in the body and the query string.
 */
export const rejectUnsupportedText = (req: Request, _res: Response, next: NextFunction): void => {
  if (containsUnsupportedText(req.body) || containsUnsupportedText(req.query)) {
    next(HttpError.unprocessable('Text contains unsupported characters'));
    return;
  }
  next();
};
