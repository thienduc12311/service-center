import { z } from 'zod';
import { parseKeysetCursor } from '../lib/keyset.js';
import { parseLocalDate } from '../lib/timezone.js';

export const uuid = z.string().uuid();
export const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());
/**
 * A keyset `before` cursor as the API issues it: a timestamp with any offset
 * (PostgREST returns `+00:00`), optionally followed by `~<row id>`.
 */
export const keysetCursorSchema = z
  .string()
  .max(100)
  .refine((value) => parseKeysetCursor(value) !== null, 'Invalid cursor');
export const nonEmpty =z.string().trim().min(1);

/** `YYYY-MM-DD`, optionally followed by a time and an offset (ISO 8601). */
const INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/**
 * Whether a string is an ISO 8601 date or date-time that exists on the
 * calendar (no 2027-02-30, no 25:00). Zone handling is left to the caller.
 */
export const isInstantString = (value: string): boolean => {
  const match = INSTANT_PATTERN.exec(value);
  if (!match || !parseLocalDate(match[1]!)) return false;
  const [hour, minute, second] = [match[2], match[3], match[4]].map((part) => (part === undefined ? 0 : Number(part)));
  return hour! <= 23 && minute! <= 59 && second! <= 59 && !Number.isNaN(Date.parse(value.replace(' ', 'T')));
};

/**
 * A plan date or time as clients send it (`2027-02-14T10:00:00Z`). Rejects
 * strings that are not a real calendar instant before they reach Postgres.
 */
export const instantString = z.string().trim().refine(isInstantString, 'Enter a valid date and time');
export const musicalKey = z.string().trim().max(8);
/**
 * A client-generated key that makes a create/copy/notify request safe to
 * retry: the server returns the first result instead of acting twice.
 */
export const idempotencyKey = z.string().trim().min(8).max(200);

/**
 * The deepest page a list may ask for. Far beyond any real list (200 x 100,000
 * rows), but small enough that `(page - 1) * per_page` stays an exact safe
 * integer: an absurd page is refused with 422 instead of echoing `1e+21` over
 * the first page or failing with 500 (W10-SEC-D1/D2).
 */
export const MAX_PAGE = 100_000;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

export const dateRangeSchema = z
  .object({ from: isoDateTime, to: isoDateTime })
  .refine((v) => new Date(v.from) < new Date(v.to), {
    message: '`from` must be before `to`',
    path: ['to'],
  });

export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;

/** Why a scheduler commits over a blocking conflict (F04); audited with the request. */
export const conflictOverrideReason = z
  .string()
  .trim()
  .min(1, 'Give a reason')
  .max(500, 'Keep the reason under 500 characters');
