/**
 * Small date helpers shared by web and native. Deliberately dependency-free so
 * the package stays usable from the Express server and from Metro.
 */

export const MS_PER_DAY = 86_400_000;

/** Returns a fresh Date so helpers never mutate caller-owned state. */
export const toDate = (value: string | number | Date): Date =>
  value instanceof Date ? new Date(value.getTime()) : new Date(value);

export const startOfDay = (value: string | number | Date): Date => {
  const d = toDate(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (value: string | number | Date): Date => {
  const d = toDate(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

export const addDays = (value: string | number | Date, days: number): Date => {
  const d = toDate(value);
  d.setDate(d.getDate() + days);
  return d;
};

export const addMonths = (value: string | number | Date, months: number): Date => {
  const d = toDate(value);
  d.setMonth(d.getMonth() + months);
  return d;
};

/** Week starting Sunday, matching how service schedules are usually read. */
export const startOfWeek = (value: string | number | Date): Date =>
  startOfDay(addDays(toDate(value), -toDate(value).getDay()));

export const startOfMonth = (value: string | number | Date): Date => {
  const d = startOfDay(value);
  d.setDate(1);
  return d;
};

export const endOfMonth = (value: string | number | Date): Date => {
  const d = startOfMonth(value);
  d.setMonth(d.getMonth() + 1);
  return new Date(d.getTime() - 1);
};

export const isSameDay = (a: string | number | Date, b: string | number | Date): boolean =>
  startOfDay(a).getTime() === startOfDay(b).getTime();

/** The 6x7 grid a month view renders, including leading/trailing days. */
export const monthGrid = (value: string | number | Date): Date[] => {
  const first = startOfWeek(startOfMonth(value));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};

export const toISODate = (value: string | number | Date): string => {
  const d = toDate(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const formatTime = (value: string | number | Date, locale = 'en-US'): string =>
  toDate(value).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

export const formatDate = (
  value: string | number | Date,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' },
  locale = 'en-US',
): string => toDate(value).toLocaleDateString(locale, opts);

export const formatDateTime = (value: string | number | Date, locale = 'en-US'): string =>
  `${formatDate(value, { weekday: 'short', month: 'short', day: 'numeric' }, locale)} · ${formatTime(value, locale)}`;

/** 285 -> "4:45". Used for song lengths and running totals. */
export const formatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** "4:45" or "285" -> 285 seconds. Returns null when unparseable. */
export const parseDuration = (input: string): number | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
};

export const overlaps = (
  aStart: string | number | Date,
  aEnd: string | number | Date,
  bStart: string | number | Date,
  bEnd: string | number | Date,
): boolean => toDate(aStart) < toDate(bEnd) && toDate(bStart) < toDate(aEnd);
