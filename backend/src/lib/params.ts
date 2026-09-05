import type { Request } from 'express';
import { HttpError } from './errors.js';

/**
 * Express 5 types route params as `string | string[]` because a pattern can
 * capture repeats. Every route here expects a single value, so read them
 * through this helper rather than casting at each call site.
 */
export const param = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw HttpError.badRequest(`Missing route parameter: ${name}`);
  }
  return value;
};
