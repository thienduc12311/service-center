import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages, POSTGREST_PAGE_SIZE } from './paging.js';

/** A table of `total` ordered rows behind a server that caps every response at 1000 rows. */
const cappedTable = (total: number) =>
  vi.fn(async (from: number, to: number) => {
    const end = Math.min(to, from + POSTGREST_PAGE_SIZE - 1, total - 1);
    return Array.from({ length: Math.max(0, end - from + 1) }, (_, index) => ({ id: from + index }));
  });

describe('fetchAllPages (W8-PERF-D2)', () => {
  it('returns every row of a table larger than the 1000-row server cap', async () => {
    const load = cappedTable(2501);
    const rows = await fetchAllPages(load);
    expect(rows).toHaveLength(2501);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2501);
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 2501 }, (_, index) => index));
    expect(load.mock.calls.map(([from]) => from)).toEqual([0, 1000, 2000]);
  });

  it('needs one extra request when the total is an exact multiple of the page size', async () => {
    const load = cappedTable(2000);
    expect(await fetchAllPages(load)).toHaveLength(2000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('stops after one request for a short or empty result', async () => {
    const short = cappedTable(5);
    expect(await fetchAllPages(short)).toHaveLength(5);
    expect(short).toHaveBeenCalledTimes(1);
    expect(await fetchAllPages(async () => null)).toEqual([]);
  });

  it('never asks for a page larger than the server cap', async () => {
    const load = cappedTable(1500);
    expect(await fetchAllPages(load, { pageSize: 5000 })).toHaveLength(1500);
    expect(load.mock.calls[0]).toEqual([0, 999]);
  });
});
