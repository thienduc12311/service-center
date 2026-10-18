export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
}

export interface ZonedLocalDateTime {
  localDate: string;
  localTime: string;
  timeZone: string;
  utcOffsetMinutes?: number;
}

export interface ResolvedZonedDateTime {
  instant: string;
  utcOffsetMinutes: number;
}

export type AmbiguousTimePolicy = 'earlier' | 'later';

export interface BlockoutOccurrenceIntent {
  occurrenceKey: string;
  localStartDate: string;
  localStartTime: string | null;
  localEndDate: string;
  localEndTime: string | null;
  startsAt: string;
  endsAt: string;
  utcOffsetMinutes: number;
}

export interface ExpandBlockoutRecurrenceInput {
  allDay: boolean;
  timeZone: string;
  localStartDate: string;
  localStartTime?: string | null;
  localEndDate: string;
  localEndTime?: string | null;
  frequency: 'weekly' | 'monthly';
  interval: number;
  end: { type: 'count'; count: number } | { type: 'until'; untilDate: string };
  monthlyMissingDate: 'skip';
  ambiguousTimePolicy: AmbiguousTimePolicy;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
};

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    formatterFor(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
};

export const parseLocalDate = (value: string): LocalDateParts | null => {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return check.getUTCFullYear() === parts.year
    && check.getUTCMonth() + 1 === parts.month
    && check.getUTCDate() === parts.day
    ? parts
    : null;
};

export const parseLocalTime = (value: string): Pick<LocalDateTimeParts, 'hour' | 'minute'> | null => {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatLocalDate = (parts: LocalDateParts): string =>
  `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}`;

export const addLocalDays = (value: string, days: number): string => {
  const parts = parseLocalDate(value);
  if (!parts) throw new Error('Enter a valid local date.');
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatLocalDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
};

const localDayDifference = (start: string, end: string): number => {
  const a = parseLocalDate(start);
  const b = parseLocalDate(end);
  if (!a || !b) throw new Error('Enter valid local dates.');
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
};

const formattedParts = (instantMs: number, timeZone: string): LocalDateTimeParts => {
  const values = new Map(
    formatterFor(timeZone).formatToParts(instantMs).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
  };
};

const sameLocalDateTime = (a: LocalDateTimeParts, b: LocalDateTimeParts): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day
  && a.hour === b.hour && a.minute === b.minute;

const offsetAt = (instantMs: number, timeZone: string): number => {
  const local = formattedParts(instantMs, timeZone);
  const localEpoch = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return Math.round((localEpoch - instantMs) / 60_000);
};

/**
 * Returns zero instants for a spring-forward gap, one normally, and two for a
 * fall-back fold. This intentionally uses only Intl so it behaves the same in
 * Node, browsers and Hermes without device-zone arithmetic.
 */
export const possibleInstantsForLocalDateTime = (
  localDate: string,
  localTime: string,
  timeZone: string,
): ResolvedZonedDateTime[] => {
  const date = parseLocalDate(localDate);
  const time = parseLocalTime(localTime);
  if (!date || !time) throw new Error('Enter a valid local date and time.');
  if (!isValidTimeZone(timeZone)) throw new Error('Choose a valid IANA timezone.');

  const requested: LocalDateTimeParts = { ...date, ...time };
  const wallEpoch = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    offsets.add(offsetAt(wallEpoch + hours * 3_600_000, timeZone));
  }

  const matches = [...offsets]
    .map((utcOffsetMinutes) => ({ instantMs: wallEpoch - utcOffsetMinutes * 60_000, utcOffsetMinutes }))
    .filter(({ instantMs }) => sameLocalDateTime(formattedParts(instantMs, timeZone), requested))
    .sort((a, b) => a.instantMs - b.instantMs);

  return matches.map(({ instantMs, utcOffsetMinutes }) => ({
    instant: new Date(instantMs).toISOString(),
    utcOffsetMinutes,
  }));
};

export const resolveZonedLocalDateTime = (input: ZonedLocalDateTime): ResolvedZonedDateTime => {
  const matches = possibleInstantsForLocalDateTime(input.localDate, input.localTime, input.timeZone);
  if (matches.length === 0) {
    throw new Error('That local time does not exist because the clock moves forward. Choose another time.');
  }
  if (matches.length === 1) return matches[0]!;
  if (input.utcOffsetMinutes == null) {
    throw new Error('That local time occurs twice because the clock moves back. Choose the earlier or later offset.');
  }
  const selected = matches.find((match) => match.utcOffsetMinutes === input.utcOffsetMinutes);
  if (!selected) throw new Error('Choose one of the available offsets for this ambiguous local time.');
  return selected;
};

const addMonthlyOccurrence = (anchor: string, months: number): string | null => {
  const parts = parseLocalDate(anchor);
  if (!parts) throw new Error('Enter a valid local date.');
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return parts.day > lastDay ? null : formatLocalDate({ year, month: month + 1, day: parts.day });
};

const resolveOccurrence = (
  input: ExpandBlockoutRecurrenceInput,
  localStartDate: string,
  localEndDate: string,
): BlockoutOccurrenceIntent => {
  const startTime = input.allDay ? '00:00' : input.localStartTime;
  const endTime = input.allDay ? '00:00' : input.localEndTime;
  if (!startTime || !endTime) throw new Error('Timed blockouts need start and end times.');
  const starts = possibleInstantsForLocalDateTime(localStartDate, startTime, input.timeZone);
  const ends = possibleInstantsForLocalDateTime(localEndDate, endTime, input.timeZone);
  if (starts.length === 0 || ends.length === 0) {
    throw new Error(`An occurrence on ${localStartDate} uses a local time skipped by daylight saving. Choose another time.`);
  }
  const choose = (values: ResolvedZonedDateTime[]): ResolvedZonedDateTime =>
    input.ambiguousTimePolicy === 'earlier' ? values[0]! : values.at(-1)!;
  const start = choose(starts);
  const end = choose(ends);
  if (new Date(start.instant) >= new Date(end.instant)) throw new Error('End must be after start.');
  return {
    occurrenceKey: `${localStartDate}T${startTime}`,
    localStartDate,
    localStartTime: input.allDay ? null : startTime,
    localEndDate,
    localEndTime: input.allDay ? null : endTime,
    startsAt: start.instant,
    endsAt: end.instant,
    utcOffsetMinutes: start.utcOffsetMinutes,
  };
};

export const expandBlockoutRecurrence = (input: ExpandBlockoutRecurrenceInput): BlockoutOccurrenceIntent[] => {
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 12) {
    throw new Error('Recurrence interval must be between 1 and 12.');
  }
  const countLimit = input.end.type === 'count' ? input.end.count : 120;
  if (!Number.isInteger(countLimit) || countLimit < 1 || countLimit > 120) {
    throw new Error('A recurring series must contain between 1 and 120 occurrences.');
  }
  if (input.end.type === 'until' && !parseLocalDate(input.end.untilDate)) {
    throw new Error('Choose a valid recurrence end date.');
  }
  const daySpan = localDayDifference(input.localStartDate, input.localEndDate);
  if (daySpan < 0 || daySpan > 366) throw new Error('Blockout ranges may span at most 366 local days.');

  const occurrences: BlockoutOccurrenceIntent[] = [];
  for (let step = 0; occurrences.length < countLimit && step < 240; step += 1) {
    const localStartDate = input.frequency === 'weekly'
      ? addLocalDays(input.localStartDate, step * input.interval * 7)
      : addMonthlyOccurrence(input.localStartDate, step * input.interval);
    if (!localStartDate) continue; // Explicit monthly policy: missing dates are skipped.
    if (input.end.type === 'until' && localStartDate > input.end.untilDate) break;
    occurrences.push(resolveOccurrence(input, localStartDate, addLocalDays(localStartDate, daySpan)));
  }
  if (occurrences.length === 0) throw new Error('The recurrence rule does not produce any occurrences.');
  if (input.end.type === 'until' && occurrences.length === 120) {
    const last = occurrences.at(-1)!;
    if (last.localStartDate < input.end.untilDate) {
      throw new Error('The recurrence range is too long. Limit it to 120 occurrences.');
    }
  }
  return occurrences;
};

export const resolveOneOffBlockout = (input: {
  allDay: boolean;
  timeZone: string;
  localStartDate: string;
  localStartTime?: string | null;
  localEndDate: string;
  localEndTime?: string | null;
  ambiguousTimePolicy: AmbiguousTimePolicy;
}): BlockoutOccurrenceIntent => resolveOccurrence(
  {
    ...input,
    frequency: 'weekly',
    interval: 1,
    end: { type: 'count', count: 1 },
    monthlyMissingDate: 'skip',
  },
  input.localStartDate,
  input.localEndDate,
);
