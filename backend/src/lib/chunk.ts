/**
 * Largest id list sent in one PostgREST `in.(...)` filter. Each uuid adds ~40
 * bytes to the GET URL, which the gateway rejects beyond a few KB ("URI too long").
 */
export const IN_FILTER_CHUNK = 100;

/** Splits a list into consecutive slices of at most `size` items. */
export const chunk = <T>(items: readonly T[], size: number = IN_FILTER_CHUNK): T[][] => {
  const slices: T[][] = [];
  for (let start = 0; start < items.length; start += size) slices.push(items.slice(start, start + size));
  return slices;
};
