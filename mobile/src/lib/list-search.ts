/**
 * Forgiving, accent-insensitive matching for lists filtered on the device
 * (the website's `frontend/src/lib/search.ts`): typing "dang an" finds
 * "Đặng An" and "nguyen" finds "Nguyễn".
 */
export const foldForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

/** True when every whitespace-separated word of `query` appears in one of `fields`. */
export const matchesSearch = (query: string, fields: ReadonlyArray<string | null | undefined>): boolean => {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = foldForSearch(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
};

/** Above this many rows a device-side list gets a search box (lists below it stay plain). */
export const LIST_SEARCH_THRESHOLD = 15;

/** Whether a list of `count` rows is long enough to need a search box. */
export const needsListSearch = (count: number, threshold: number = LIST_SEARCH_THRESHOLD): boolean => count > threshold;
