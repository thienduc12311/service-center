import { searchWords } from '@service-center/shared';
import { raw, type Db } from './supabase.js';

/**
 * Large-list search over a table's generated `search_text` column (folded by
 * the database's `private.search_fold`: unaccented, đ→d, lowercased).
 *
 * The query is folded the same way (`searchWords`), split on whitespace, and
 * every word must appear (AND): one `imatch` filter per word, which PostgREST
 * ANDs together and the column's GIN trigram index serves.
 */

/**
 * A word as a literal case-insensitive regex (`imatch`, Postgres `~*`). Not
 * `ilike`: PostgREST turns every `*` in a like pattern into `%`, so "a*b"
 * would match like "a%b" and a lone `*` would match everyone. Every character
 * that is not a letter, digit or space is backslash-escaped, which Postgres
 * regexes read as that literal character (`%`, `_`, `\`, `*`, `.`, ...).
 */
export const literalSearchPattern = (text: string): string => text.replace(/[^\p{L}\p{N}\s]/gu, (char) => `\\${char}`);

/** How a `rawSelect` reads: `count: 'exact'` adds the total; `head` skips the rows. */
export interface RawSelectOptions {
  count?: 'exact';
  head?: boolean;
}

/**
 * `select` on the untyped client with the column list typed as plain text, so
 * every caller gets the same builder type (`RawQuery`) and can share filter
 * helpers such as `whereSearchMatches`.
 */
export const rawSelect = (db: Db, table: string, columns: string, options?: RawSelectOptions) =>
  raw(db).from(table).select(columns, options);

/** The PostgREST filter builder `rawSelect` returns. */
export type RawQuery = ReturnType<typeof rawSelect>;

/** The column every searchable table and view folds its search fields into. */
export const SEARCH_TEXT_COLUMN = 'search_text';

/** Narrows `builder` to rows whose `search_text` contains every word of `query`; unchanged for a blank query. */
export const whereSearchMatches = (builder: RawQuery, query: string | null | undefined): RawQuery =>
  searchWords(query).reduce<RawQuery>(
    (narrowed, word) => narrowed.filter(SEARCH_TEXT_COLUMN, 'imatch', literalSearchPattern(word)),
    builder,
  );
