/** Same rule as `organizations.slug` and `churchSlugSchema`: 2–40 of a–z, 0–9 and dashes. */
export const SLUG_MAX_LENGTH = 40;

/** Letters NFKD does not decompose into a base letter plus a mark. */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  đ: 'd',
  ð: 'd',
  ø: 'o',
  ł: 'l',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
};

/** A URL slug suggested from a church name ("Nguồn Sống Atlanta" → "nguon-song-atlanta"). */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[đðøłæœß]/g, (letter) => LETTER_FOLDS[letter] ?? '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

/** Lowercase as the admin types; the schema validates the rest. */
export const normalizeSlugInput = (text: string): string => text.toLowerCase().replace(/\s+/g, '-');
