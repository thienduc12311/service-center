import { foldSearchText, searchWords } from '@service-center/shared';

/**
 * Folds text for forgiving, accent-insensitive matching, so typing "dang an"
 * finds "Đặng An" and "nguyen" finds "Nguyễn". The same fold the API applies
 * to its `search_text` columns (shared `foldSearchText`), so a client-side
 * filter and a server search agree on what matches.
 */
export const foldForSearch = (value: string): string => foldSearchText(value);

/** True when every whitespace-separated word of `query` appears in one of `fields`. */
export const matchesSearch = (query: string, fields: ReadonlyArray<string | null | undefined>): boolean => {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const haystack = foldForSearch(fields.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
};
