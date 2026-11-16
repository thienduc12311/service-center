/** The viewer's own zone, the default for a new church. */
export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (error) {
    if (error instanceof RangeError) return 'UTC';
    throw error;
  }
};

/** Every zone the browser knows, plus the current value if it is missing (e.g. "UTC" on some engines). */
export const timeZoneOptions = (current: string, available: readonly string[] = Intl.supportedValuesOf('timeZone')): string[] => {
  const zones = new Set(available);
  if (current) zones.add(current);
  return [...zones].sort((a, b) => a.localeCompare(b));
};
