/**
 * Folds text for forgiving, accent-insensitive matching, so typing "dang an"
 * finds "Đặng An" and "nguyen" finds "Nguyễn".
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
