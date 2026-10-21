/**
 * The native date/time pickers hand back a device-local `Date`; these read and
 * build its wall-clock parts as `YYYY-MM-DD` / `HH:MM`. Which timezone the
 * wall clock means (usually the organization's) is decided by the caller.
 */
const pad = (value: number): string => String(value).padStart(2, '0');

export const civilDate = (value: Date): string => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;

export const civilTime = (value: Date): string => `${pad(value.getHours())}:${pad(value.getMinutes())}`;

/** A device-local `Date` showing this wall-clock date and time, to seed a picker. */
export const dateForPicker = (date: string, time = '12:00'): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year!, month! - 1, day!, hour!, minute!);
};
