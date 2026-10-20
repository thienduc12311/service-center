import type { PlanTimeRow } from '../types/database.js';
import type { ReplacementRequestRow } from '../types/opportunities.js';

/**
 * MOB-010: client-side rules for F07 replacement requests, shared by the
 * website and the native app so both send the same expiry and show the same
 * required times.
 */

/** How long a new replacement request stays open when the service is further away. */
export const REPLACEMENT_REQUEST_OPEN_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * The `expires_at` to send with a new request: seven days, but never past the
 * first time the replacement would have to be there. Null when that time has
 * already started, so no request should be offered.
 */
export const replacementRequestExpiry = (
  now: Date,
  requiredTimes: readonly Pick<PlanTimeRow, 'starts_at'>[],
): string | null => {
  const limit = now.getTime() + REPLACEMENT_REQUEST_OPEN_DAYS * DAY_MS;
  const starts = requiredTimes.map((time) => new Date(time.starts_at).getTime()).filter(Number.isFinite);
  const first = starts.length ? Math.min(...starts) : null;
  if (first !== null && first <= now.getTime()) return null;
  return new Date(first === null ? limit : Math.min(limit, first)).toISOString();
};

/**
 * The plan times a request covers, in start order. An empty
 * `applicable_time_ids` means every plan time (the original was asked for all).
 */
export const replacementRequiredTimes = <T extends Pick<PlanTimeRow, 'id' | 'starts_at'>>(
  request: Pick<ReplacementRequestRow, 'applicable_time_ids'>,
  planTimes: readonly T[],
): T[] => {
  const wanted = new Set(request.applicable_time_ids);
  return planTimes
    .filter((time) => wanted.size === 0 || wanted.has(time.id))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
};
