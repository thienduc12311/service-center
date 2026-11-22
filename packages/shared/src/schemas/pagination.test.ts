import { describe, expect, it } from 'vitest';
import { MAX_PAGE, paginationSchema } from './common.js';
import { listPlansQuerySchema } from './plan.js';
import { listSongsQuerySchema } from './song.js';

describe('pagination boundary (W10-SEC-D1/D2)', () => {
  const lists = [paginationSchema, listPlansQuerySchema, listSongsQuerySchema];

  it('refuses absurd, unsafe and non-integer pages on every paged list', () => {
    for (const schema of lists) {
      for (const page of ['99999999999999999999', '1e21', '9007199254740993', String(MAX_PAGE + 1), '0', '-1', '1.5', 'abc']) {
        expect(schema.safeParse({ page }).success, page).toBe(false);
      }
    }
  });

  it('accepts the first and the deepest page, and defaults to page 1', () => {
    for (const schema of lists) {
      expect(schema.parse({ page: '1' }).page).toBe(1);
      expect(schema.parse({ page: String(MAX_PAGE) }).page).toBe(MAX_PAGE);
      expect(schema.parse({}).page).toBe(1);
    }
  });
});
