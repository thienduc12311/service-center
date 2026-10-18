/**
 * F10: turning template wall-clock times into instants, and a bounded
 * local-date series into proposed plans. Pure: the API runs the same code for
 * preview and commit, and the database re-checks every instant against the
 * template's local intent.
 */
import type {
  GenerationDateProblem,
  GenerationExcludedDate,
  PlanTemplateContent,
  PlanTemplateCounts,
  PlanTemplateTime,
} from '../types/plan-templates.js';
import type { AmbiguousTimeChoice, GenerationDateEdit } from '../schemas/plan-templates.js';
import { addLocalDays, localDateAt, localDaysBetween, possibleInstantsForLocalDateTime } from './timezone.js';

/** One generation batch is created in a single transaction, so it stays small. */
export const MAX_GENERATED_PLANS = 12;

export interface ResolvedTemplateTime {
  starts_at: string;
  ends_at: string;
}

export type TemplateTimesResolution =
  | { ok: true; times: ResolvedTemplateTime[]; service_date: string }
  | { ok: false; message: string };

const resolveWallClock = (
  localDate: string,
  localTime: string,
  timeZone: string,
  ambiguous: AmbiguousTimeChoice,
): string | null => {
  const matches = possibleInstantsForLocalDateTime(localDate, localTime, timeZone);
  if (matches.length === 0) return null;
  return (ambiguous === 'earlier' ? matches[0]! : matches.at(-1)!).instant;
};

/**
 * Resolves each template time on `localDate` in `timeZone`. A time skipped by
 * a spring-forward change is reported rather than shifted; a time that occurs
 * twice uses the explicit `ambiguous` choice. Durations are elapsed minutes.
 * The plan's service date is its first service time on the day itself, else
 * its first time on the day, else local noon.
 */
export const resolveTemplateTimes = (
  times: readonly PlanTemplateTime[],
  localDate: string,
  timeZone: string,
  ambiguous: AmbiguousTimeChoice,
): TemplateTimesResolution => {
  const resolved: ResolvedTemplateTime[] = [];
  for (const time of times) {
    const date = addLocalDays(localDate, time.day_offset);
    const start = resolveWallClock(date, time.local_start, timeZone, ambiguous);
    if (!start) {
      return {
        ok: false,
        message: `${time.local_start} on ${date} does not exist in ${timeZone} because the clock moves forward. Move this date or change the template time.`,
      };
    }
    resolved.push({
      starts_at: start,
      ends_at: new Date(new Date(start).getTime() + time.duration_minutes * 60_000).toISOString(),
    });
  }
  const sameDay = times.map((time, index) => ({ time, index })).filter(({ time }) => time.day_offset === 0);
  const anchor = sameDay.find(({ time }) => time.kind === 'service') ?? sameDay[0];
  const serviceDate = anchor
    ? resolved[anchor.index]!.starts_at
    : resolveWallClock(localDate, '12:00', timeZone, ambiguous);
  if (!serviceDate) return { ok: false, message: `Noon on ${localDate} does not exist in ${timeZone}.` };
  return { ok: true, times: resolved, service_date: serviceDate };
};

/** Whether a local wall-clock time on a date occurs twice (DST fall-back). */
export const isAmbiguousLocalTime = (localDate: string, localTime: string, timeZone: string): boolean =>
  possibleInstantsForLocalDateTime(localDate, localTime, timeZone).length > 1;

export interface PlanSeriesExpansionInput {
  start_date: string;
  interval_weeks: number;
  count: number;
  end_date?: string | undefined;
  excluded_dates: readonly string[];
  edits: readonly GenerationDateEdit[];
  default_title: string;
}

export interface ProposedSeriesDate {
  /** The date the series produced (stable identity for edits). */
  series_date: string;
  /** The date the plan will have (after a move). */
  local_date: string;
  title: string;
}

export interface PlanSeriesExpansion {
  dates: ProposedSeriesDate[];
  excluded: GenerationExcludedDate[];
  problems: GenerationDateProblem[];
}

/**
 * Weekly local dates: `count` occurrences every `interval_weeks` weeks from
 * `start_date`, stopping at `end_date`. Excluded dates (holidays) and skipped
 * dates are listed, not silently dropped, and do not count toward `count`'s
 * cap of {@link MAX_GENERATED_PLANS} created plans. Calendar arithmetic only:
 * a week is seven civil days, never 168 hours.
 */
export const expandPlanSeries = (input: PlanSeriesExpansionInput): PlanSeriesExpansion => {
  const excludedSet = new Set(input.excluded_dates);
  const edits = new Map(input.edits.map((edit) => [edit.local_date, edit]));
  const dates: ProposedSeriesDate[] = [];
  const excluded: GenerationExcludedDate[] = [];
  const problems: GenerationDateProblem[] = [];
  const count = Math.min(input.count, MAX_GENERATED_PLANS);

  for (let step = 0; dates.length < count && step < 104; step += 1) {
    const seriesDate = addLocalDays(input.start_date, step * input.interval_weeks * 7);
    if (input.end_date && seriesDate > input.end_date) break;
    if (excludedSet.has(seriesDate)) {
      excluded.push({ local_date: seriesDate, reason: 'excluded' });
      continue;
    }
    const edit = edits.get(seriesDate);
    if (edit?.skip) {
      excluded.push({ local_date: seriesDate, reason: 'skipped' });
      continue;
    }
    dates.push({
      series_date: seriesDate,
      local_date: edit?.move_to ?? seriesDate,
      title: edit?.title ?? input.default_title,
    });
  }

  const seen = new Map<string, string>();
  for (const date of dates) {
    const other = seen.get(date.local_date);
    if (other) {
      problems.push({ local_date: date.local_date, message: `${date.series_date} and ${other} would both be on ${date.local_date}.` });
    }
    seen.set(date.local_date, date.series_date);
  }
  for (const editDate of edits.keys()) {
    if (!dates.some((date) => date.series_date === editDate) && !excluded.some((date) => date.local_date === editDate)) {
      problems.push({ local_date: editDate, message: `${editDate} is not one of the proposed dates.` });
    }
  }
  if (dates.length === 0) problems.push({ local_date: input.start_date, message: 'The series produces no dates.' });
  return { dates, excluded, problems };
};

export const templateCounts = (content: PlanTemplateContent | null | undefined): PlanTemplateCounts => ({
  times: content?.times.length ?? 0,
  items: content?.items.length ?? 0,
  needs: content?.needs.length ?? 0,
  roster: content?.roster.length ?? 0,
  has_notes: Boolean(content?.notes),
});

export const TEMPLATE_COMPONENT_LABELS: Record<'times' | 'notes' | 'items' | 'needs' | 'roster', string> = {
  times: 'Times',
  notes: 'Plan notes',
  items: 'Order of service',
  needs: 'Needed positions',
  roster: 'Roster pattern (prepared requests)',
};

export const TEMPLATE_SKIP_REASON_LABELS: Record<string, string> = {
  song_missing: 'its song was deleted',
  position_missing: 'its team or position no longer exists',
  person_unavailable: 'the person is archived or no longer in the organization',
  not_permitted: 'you do not schedule that team here',
};

// ------------------------------------------------- F10 Pass C: reschedule --

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local `HH:MM` of an instant in an IANA zone. */
export const localTimeAt = (instant: string, timeZone: string): string => {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(instant));
};

export interface ShiftablePlan {
  service_date: string;
  times: ReadonlyArray<{ id: string; starts_at: string; ends_at: string }>;
}

export interface ShiftedPlan {
  service_date: string;
  times: Array<{ id: string; starts_at: string; ends_at: string }>;
}

export type PlanShiftResolution = { ok: true; plan: ShiftedPlan } | { ok: false; message: string };

/**
 * Moves a plan to `newLocalDate` by whole civil days: every time keeps its
 * local clock and its day relative to the service date; durations are kept
 * as elapsed time. A local time skipped by DST is reported, never shifted.
 */
export const shiftPlanToDate = (
  plan: ShiftablePlan,
  newLocalDate: string,
  timeZone: string,
  ambiguous: AmbiguousTimeChoice,
): PlanShiftResolution => {
  const days = localDaysBetween(localDateAt(plan.service_date, timeZone), newLocalDate);
  const move = (instant: string): string | null =>
    resolveWallClock(addLocalDays(localDateAt(instant, timeZone), days), localTimeAt(instant, timeZone), timeZone, ambiguous);
  const serviceDate = move(plan.service_date);
  if (!serviceDate) {
    return { ok: false, message: `The service time does not exist on ${newLocalDate} in ${timeZone} (clocks move forward).` };
  }
  const times: ShiftedPlan['times'] = [];
  for (const time of plan.times) {
    const start = move(time.starts_at);
    if (!start) {
      return { ok: false, message: `${localTimeAt(time.starts_at, timeZone)} does not exist after moving to ${newLocalDate} in ${timeZone}.` };
    }
    const duration = new Date(time.ends_at).getTime() - new Date(time.starts_at).getTime();
    times.push({ id: time.id, starts_at: start, ends_at: new Date(new Date(start).getTime() + duration).toISOString() });
  }
  return { ok: true, plan: { service_date: serviceDate, times } };
};
