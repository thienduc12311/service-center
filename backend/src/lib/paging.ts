/**
 * PostgREST silently caps every response at `max_rows` (1000 locally and on
 * the hosted project), so an unpaged list select returns a truncated answer
 * with a 200 (W8-PERF-D2). `fetchAllPages` reads a query page by page until a
 * short page proves it is exhausted.
 */

/** Matches `max_rows` in supabase/config.toml; a page this long may have more behind it. */
export const POSTGREST_PAGE_SIZE = 1000;

/** Loads rows `from..to` (inclusive) of one query that has a stable, total `order`. */
export type LoadPage<T> = (from: number, to: number) => PromiseLike<T[] | null>;

export interface FetchAllPagesOptions {
  /** Rows per request; defaults to (and must not exceed) the server's `max_rows`. */
  pageSize?: number;
}

/**
 * The query behind `loadPage` MUST order by a unique key (end with `id`),
 * otherwise rows can repeat or vanish across page boundaries.
 */
export const fetchAllPages = async <T>(loadPage: LoadPage<T>, options: FetchAllPagesOptions = {}): Promise<T[]> => {
  const pageSize = Math.min(Math.max(1, options.pageSize ?? POSTGREST_PAGE_SIZE), POSTGREST_PAGE_SIZE);
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = (await loadPage(from, from + pageSize - 1)) ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
};

/** `.in()` lists stay well inside URL limits. */
export const IN_CHUNK_SIZE = 100;

const chunks = <T>(values: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += IN_CHUNK_SIZE) out.push(values.slice(start, start + IN_CHUNK_SIZE));
  return out;
};

export const inChunks = async <T>(ids: readonly string[], load: (chunk: string[]) => PromiseLike<T[] | null>): Promise<T[]> => {
  const rows: T[] = [];
  for (const chunk of chunks(ids)) rows.push(...((await load(chunk)) ?? []));
  return rows;
};
