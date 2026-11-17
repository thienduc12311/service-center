import type { Request } from 'express';
import { HttpError } from './errors.js';

/** Any Postgres `uuid` literal in its canonical hyphenated form. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * Every route parameter named `id` or `…Id` addresses a uuid row. Checking the
 * shape here turns a malformed id into a 400 before it reaches Postgres
 * (which would otherwise answer with a raw `22P02` error).
 */
const isIdName = (name: string): boolean => name === 'id' || name.endsWith('Id');

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
  if (isIdName(name) && !isUuid(value)) {
    throw HttpError.badRequest(`Invalid route parameter: ${name}`);
  }
  return value;
};
