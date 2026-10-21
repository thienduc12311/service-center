import {
  addLocalDays,
  localDateAt,
  parseLocalDate,
  possibleInstantsForLocalDateTime,
  type AmbiguousTimeChoice,
  type CreatePlanRequest,
} from '@service-center/shared';

/**
 * MOB-013 Pass A: one dated plan on the existing `POST /plans`. The website's
 * New plan form seeds one service time of this length so the plan shows on
 * calendars; native seeds the same.
 */
export const NEW_PLAN_SERVICE_MINUTES = 90;

/** What the native New plan form holds; dates/times are the organization's wall clock. */
export interface NewPlanDraft {
  title: string;
  localDate: string;
  localTime: string;
  serviceTypeId: string | null;
  location: string;
}

/** The start instant, or why the wall-clock time does not name exactly one. */
export type PlanStartResolution =
  | { kind: 'resolved'; startsAt: string; repeated: boolean }
  /** Spring forward: the time does not exist on that date. */
  | { kind: 'skipped' }
  | { kind: 'invalid' };

/**
 * Resolves the organization-timezone wall-clock start with the shared IANA
 * resolver (no device-zone arithmetic). A time that occurs twice uses the
 * chosen one, like the website's template generation.
 */
export const resolvePlanStart = (
  localDate: string,
  localTime: string,
  timeZone: string,
  ambiguous: AmbiguousTimeChoice,
): PlanStartResolution => {
  let matches;
  try {
    matches = possibleInstantsForLocalDateTime(localDate, localTime, timeZone);
  } catch {
    return { kind: 'invalid' };
  }
  if (matches.length === 0) return { kind: 'skipped' };
  const chosen = ambiguous === 'later' ? matches.at(-1)! : matches[0]!;
  return { kind: 'resolved', startsAt: chosen.instant, repeated: matches.length > 1 };
};

/** The next Sunday after today in the organization's timezone (the website's suggestion, there in device time). */
export const nextLocalSunday = (now: Date, timeZone: string): string => {
  const today = localDateAt(now.getTime(), timeZone);
  const parts = parseLocalDate(today)!;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return addLocalDays(today, (7 - weekday) % 7 || 7);
};

/**
 * The create request. The idempotency key belongs to this draft: a retry of
 * the same draft sends the same key and gets the same plan back.
 */
export const createPlanBody = (
  draft: NewPlanDraft,
  startsAt: string,
  serviceTimeName: string,
  idempotencyKey: string,
): CreatePlanRequest => {
  const endsAt = new Date(new Date(startsAt).getTime() + NEW_PLAN_SERVICE_MINUTES * 60_000).toISOString();
  return {
    title: draft.title.trim(),
    service_date: startsAt,
    service_type_id: draft.serviceTypeId,
    location: draft.location.trim() || null,
    status: 'draft',
    times: [{ kind: 'service', name: serviceTimeName, starts_at: startsAt, ends_at: endsAt }],
    idempotency_key: idempotencyKey,
  };
};
