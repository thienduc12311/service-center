/**
 * F04 / MOB-015: the plan time editor's draft, shared by the website and the
 * app so both send the same `PATCH /plans/:id` times for the same choices.
 *
 * Times are entered on the organization's wall clock (IANA zone), never the
 * device's, and resolved with the shared Intl-only resolver. A time skipped
 * by a spring-forward change is reported, not shifted; a time that occurs
 * twice uses the row's explicit earlier/later choice. Every row keeps its
 * stable id: existing times keep theirs across reorder and edits, new rows
 * carry a client id that the preview and the commit both use.
 */
import type { AmbiguousTimeChoice } from '../schemas/plan-templates.js';
import type { PlanTimeRequest, UpdatePlanRequest } from '../schemas/plan.js';
import type { OrphanResolutionAction, PlanTimeImpact } from '../types/attendance.js';
import type { PlanTimeKind, PlanTimeRow } from '../types/database.js';
import { localTimeAt } from './plan-templates.js';
import { addLocalDays, localDateAt, possibleInstantsForLocalDateTime } from './timezone.js';

/** `planTimeSchema` allows at most this many times on a plan. */
export const MAX_PLAN_TIMES = 20;

export const PLAN_TIME_KINDS: readonly PlanTimeKind[] = ['service', 'rehearsal', 'other'];

/** The saved time a row was opened from, so an untouched row sends exactly what is stored. */
export interface PlanTimeDraftOrigin {
  starts_at: string;
  ends_at: string;
  localDate: string;
  localStart: string;
  localEnd: string;
  ambiguous: AmbiguousTimeChoice;
}

/** One editable time; `localDate`/`localStart`/`localEnd` are the organization's wall clock. */
export interface PlanTimeDraft {
  id: string;
  kind: PlanTimeKind;
  name: string;
  localDate: string;
  localStart: string;
  localEnd: string;
  /** Which instant to use when a wall-clock time occurs twice (DST fall-back). */
  ambiguous: AmbiguousTimeChoice;
  origin: PlanTimeDraftOrigin | null;
}

export type PlanTimeDraftProblemCode =
  /** A date or time is missing or malformed. */
  | 'incomplete'
  /** Start and end are the same wall-clock time. */
  | 'same_time'
  /** The start does not exist on that date (spring forward). */
  | 'start_skipped'
  /** The end does not exist on that date (spring forward). */
  | 'end_skipped';

export interface PlanTimeDraftProblem {
  id: string;
  code: PlanTimeDraftProblemCode;
}

export type PlanTimeDraftResolution =
  | { ok: true; times: PlanTimeRequest[] }
  | { ok: false; problems: PlanTimeDraftProblem[] };

/** An end at or before the start means the time runs past midnight. */
export const planTimeEndsNextDay = (draft: Pick<PlanTimeDraft, 'localStart' | 'localEnd'>): boolean =>
  Boolean(draft.localStart && draft.localEnd) && draft.localEnd < draft.localStart;

const choiceFor = (instant: string, localDate: string, localTime: string, timeZone: string): AmbiguousTimeChoice | null => {
  const matches = possibleInstantsForLocalDateTime(localDate, localTime, timeZone);
  if (matches.length < 2) return null;
  return new Date(matches.at(-1)!.instant).getTime() === new Date(instant).getTime() ? 'later' : 'earlier';
};

/** A saved time as an editable row, on the organization's clock. */
export const planTimeDraftFrom = (time: Pick<PlanTimeRow, 'id' | 'kind' | 'name' | 'starts_at' | 'ends_at'>, timeZone: string): PlanTimeDraft => {
  const localDate = localDateAt(time.starts_at, timeZone);
  const localStart = localTimeAt(time.starts_at, timeZone);
  const localEnd = localTimeAt(time.ends_at, timeZone);
  const ambiguous =
    choiceFor(time.starts_at, localDate, localStart, timeZone)
    ?? choiceFor(time.ends_at, localDateAt(time.ends_at, timeZone), localEnd, timeZone)
    ?? 'earlier';
  return {
    id: time.id,
    kind: time.kind,
    name: time.name ?? '',
    localDate,
    localStart,
    localEnd,
    ambiguous,
    origin: { starts_at: time.starts_at, ends_at: time.ends_at, localDate, localStart, localEnd, ambiguous },
  };
};

/** The plan's times in their saved order. */
export const planTimeDraftsFrom = (
  times: readonly Pick<PlanTimeRow, 'id' | 'kind' | 'name' | 'starts_at' | 'ends_at' | 'sort_order'>[],
  timeZone: string,
): PlanTimeDraft[] =>
  [...times].sort((a, b) => a.sort_order - b.sort_order).map((time) => planTimeDraftFrom(time, timeZone));

/** A new row: the previous row's date and hours, else 10:00–12:00 on `fallbackDate`. */
export const newPlanTimeDraft = (id: string, like: PlanTimeDraft | undefined, fallbackDate: string): PlanTimeDraft => ({
  id,
  kind: 'service',
  name: '',
  localDate: like?.localDate ?? fallbackDate,
  localStart: like?.localStart ?? '10:00',
  localEnd: like?.localEnd ?? '12:00',
  ambiguous: 'earlier',
  origin: null,
});

/** Swaps a row with its neighbour; `null` at either end. Ids never change. */
export const movePlanTimeDraft = (drafts: readonly PlanTimeDraft[], index: number, direction: -1 | 1): PlanTimeDraft[] | null => {
  const target = index + direction;
  if (index < 0 || index >= drafts.length || target < 0 || target >= drafts.length) return null;
  const next = [...drafts];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

/** Whether a wall-clock start or end on this row occurs twice, so the earlier/later choice matters. */
export const planTimeDraftIsRepeated = (draft: PlanTimeDraft, timeZone: string): boolean => {
  try {
    const endDate = planTimeEndsNextDay(draft) ? addLocalDays(draft.localDate, 1) : draft.localDate;
    return possibleInstantsForLocalDateTime(draft.localDate, draft.localStart, timeZone).length > 1
      || possibleInstantsForLocalDateTime(endDate, draft.localEnd, timeZone).length > 1;
  } catch {
    return false;
  }
};

const untouched = (draft: PlanTimeDraft): boolean =>
  draft.origin !== null
  && draft.localDate === draft.origin.localDate
  && draft.localStart === draft.origin.localStart
  && draft.localEnd === draft.origin.localEnd
  && draft.ambiguous === draft.origin.ambiguous;

type InstantResult = { instant: string } | { problem: PlanTimeDraftProblemCode };

const resolveInstant = (
  localDate: string,
  localTime: string,
  timeZone: string,
  choice: AmbiguousTimeChoice,
  skipped: PlanTimeDraftProblemCode,
): InstantResult => {
  let matches;
  try {
    matches = possibleInstantsForLocalDateTime(localDate, localTime, timeZone);
  } catch {
    return { problem: 'incomplete' };
  }
  if (matches.length === 0) return { problem: skipped };
  return { instant: (choice === 'later' ? matches.at(-1)! : matches[0]!).instant };
};

/**
 * The full time list to preview and save, in row order (`sort_order` = row
 * index). An untouched saved row sends its stored instants unchanged (so a
 * rename or a reorder never reads as a moved time); a multi-day saved time
 * keeps its span until its date or hours are edited.
 */
export const resolvePlanTimeDrafts = (drafts: readonly PlanTimeDraft[], timeZone: string): PlanTimeDraftResolution => {
  const problems: PlanTimeDraftProblem[] = [];
  const times: PlanTimeRequest[] = [];
  drafts.forEach((draft, index) => {
    const base = { id: draft.id, kind: draft.kind, name: draft.name.trim() || null, sort_order: index };
    if (untouched(draft)) {
      times.push({ ...base, starts_at: draft.origin!.starts_at, ends_at: draft.origin!.ends_at });
      return;
    }
    if (!draft.localDate || !draft.localStart || !draft.localEnd) {
      problems.push({ id: draft.id, code: 'incomplete' });
      return;
    }
    if (draft.localStart === draft.localEnd) {
      problems.push({ id: draft.id, code: 'same_time' });
      return;
    }
    const start = resolveInstant(draft.localDate, draft.localStart, timeZone, draft.ambiguous, 'start_skipped');
    if ('problem' in start) {
      problems.push({ id: draft.id, code: start.problem });
      return;
    }
    let endDate: string;
    try {
      endDate = planTimeEndsNextDay(draft) ? addLocalDays(draft.localDate, 1) : draft.localDate;
    } catch {
      problems.push({ id: draft.id, code: 'incomplete' });
      return;
    }
    const end = resolveInstant(endDate, draft.localEnd, timeZone, draft.ambiguous, 'end_skipped');
    if ('problem' in end) {
      problems.push({ id: draft.id, code: end.problem });
      return;
    }
    // On a fall-back night an "earlier" 01:30 end can precede a "later" 01:15 start.
    if (new Date(end.instant).getTime() <= new Date(start.instant).getTime()) {
      problems.push({ id: draft.id, code: 'same_time' });
      return;
    }
    times.push({ ...base, starts_at: start.instant, ends_at: end.instant });
  });
  return problems.length ? { ok: false, problems } : { ok: true, times };
};

/** Nothing anyone is asked to attend moves: the website saves without a review step. */
export const planTimeImpactNeedsReview = (impact: PlanTimeImpact): boolean =>
  impact.assignments.length > 0 || impact.hidden_affected > 0 || impact.live_requests > 0;

/** Selected-time requests left with no time that still need "all times" or "remove". */
export const unresolvedOrphans = (
  impact: PlanTimeImpact,
  resolutions: Readonly<Record<string, OrphanResolutionAction>>,
): string[] =>
  impact.assignments
    .filter((assignment) => assignment.orphaned && !resolutions[assignment.assignment_id])
    .map((assignment) => assignment.assignment_id);

/** What the reviewer chose for the reviewed impact. */
export interface PlanTimesCommitChoice {
  impact: PlanTimeImpact;
  resolutions: Readonly<Record<string, OrphanResolutionAction>>;
  /** Re-send affected released requests (the server default). */
  notify: boolean;
}

/**
 * The `PATCH /plans/:id` body for a reviewed time list. It carries the
 * revision and impact hash of the preview, so a plan or audience that changed
 * after review is refused (409) instead of silently affecting more requests.
 */
export const updatePlanTimesBody = (
  times: readonly PlanTimeRequest[],
  { impact, resolutions, notify }: PlanTimesCommitChoice,
): UpdatePlanRequest => ({
  times: [...times],
  expected_revision: impact.content_revision,
  time_impact_hash: impact.impact_hash,
  orphan_resolutions: impact.assignments.flatMap((assignment) => {
    const action = assignment.orphaned ? resolutions[assignment.assignment_id] : undefined;
    return action ? [{ assignment_id: assignment.assignment_id, action }] : [];
  }),
  notify_time_changes: notify,
});

/**
 * An identity for the time list a preview was made from. A review is only
 * valid for the exact list it previewed; any edit after that needs a new one.
 */
export const planTimesFingerprint = (times: readonly PlanTimeRequest[]): string =>
  JSON.stringify(times.map((time) => [time.id, time.kind, time.name ?? null, time.starts_at, time.ends_at, time.sort_order]));
