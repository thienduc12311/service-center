/**
 * Accent-insensitive list search, folded the same way as the database's
 * `private.search_fold` (unaccent + đ→d + lowercase), so a word the API folds
 * here matches the stored `search_text` columns: "nguyen" finds "Nguyễn",
 * "chua" finds "Chúa", "dang an" finds "Đặng An".
 */

/**
 * Letters Unicode does not decompose into base + mark (so NFD leaves them
 * alone) but Postgres' unaccent rules map to Latin. Lowercase only: the input
 * is lowercased first.
 */
const UNDECOMPOSED_LETTERS: Readonly<Record<string, string>> = {
  đ: 'd',
  ð: 'd',
  ø: 'o',
  ł: 'l',
  ŀ: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ħ: 'h',
  ı: 'i',
  þ: 'th',
  ĳ: 'ij',
};

const UNDECOMPOSED_PATTERN = new RegExp(`[${Object.keys(UNDECOMPOSED_LETTERS).join('')}]`, 'g');

/** Text with accents and case removed, as the database folds `search_text`. */
export const foldSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(UNDECOMPOSED_PATTERN, (letter) => UNDECOMPOSED_LETTERS[letter] ?? letter)
    .trim();

/**
 * The folded, whitespace-separated words of a search query. Every word must
 * appear in a row's searchable text for the row to match; an empty list means
 * "no search".
 */
export const searchWords = (query: string | null | undefined): string[] =>
  query ? foldSearchText(query).split(/\s+/).filter(Boolean) : [];
