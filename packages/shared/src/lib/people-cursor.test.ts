import { describe, expect, it } from 'vitest';
import { decodePeopleCursor, encodePeopleCursor, flattenPeoplePages } from './people-cursor.js';
import { listPeoplePageQuerySchema, PEOPLE_PAGE_SIZE } from '../schemas/roster.js';

const id = '00000000-0000-4000-8000-000000000007';

describe('People list paging', () => {
  it('round-trips names with separators, accents and spaces', () => {
    for (const sort_name of ['ann lee', 'zoë ~ o\'brien', 'a,b"c(d)', '']) {
      expect(decodePeopleCursor(encodePeopleCursor({ sort_name, id }))).toEqual({ sort_name, id });
    }
  });
  it('rejects forged cursors', () => {
    for (const bad of ['forged', 'x~nope', '%E0%A4%A~' + id]) expect(decodePeopleCursor(bad)).toBeNull();
  });
  it('defaults to 25 and caps at 100', () => {
    expect(listPeoplePageQuerySchema.parse({}).limit).toBe(PEOPLE_PAGE_SIZE);
    expect(PEOPLE_PAGE_SIZE).toBe(25);
    expect(listPeoplePageQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(listPeoplePageQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listPeoplePageQuerySchema.parse({ include_archived: 'true' }).include_archived).toBe(true);
  });
  it('flattens pages without repeats', () => {
    const rows = flattenPeoplePages([{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
