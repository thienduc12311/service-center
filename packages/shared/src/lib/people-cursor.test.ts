import { describe, expect, it } from 'vitest';
import { PEOPLE_CURSOR_MAX, decodePeopleCursor, encodePeopleCursor, flattenPeoplePages } from './people-cursor.js';
import { listPeoplePageQuerySchema, PEOPLE_PAGE_SIZE } from '../schemas/roster.js';

const id = '00000000-0000-4000-8000-000000000007';

describe('People list paging', () => {
  it('round-trips names with separators, accents and spaces', () => {
    for (const sort_name of ['ann lee', 'zoë ~ o\'brien', 'a,b"c(d)', '', 'nguyễn thị ánh', '😀 emoji']) {
      expect(decodePeopleCursor(encodePeopleCursor({ sort_name, id }))).toEqual({ sort_name, id });
    }
  });

  it('keeps the longest non-Latin name inside the accepted cursor length', () => {
    // 80 + space + 80: the longest sort_name the People schemas allow.
    const thai = 'ก'.repeat(80);
    const sort_name = `${thai} ${thai}`;
    expect(sort_name).toHaveLength(161);
    const cursor = encodePeopleCursor({ sort_name, id });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor.length).toBeLessThanOrEqual(PEOPLE_CURSOR_MAX);
    expect(listPeoplePageQuerySchema.safeParse({ cursor }).success).toBe(true);
    expect(decodePeopleCursor(cursor)).toEqual({ sort_name, id });
  });

  it('fits the worst case: 161 characters JSON has to escape', () => {
    const cursor = encodePeopleCursor({ sort_name: '\u0001'.repeat(161), id });
    expect(cursor.length).toBeLessThanOrEqual(PEOPLE_CURSOR_MAX);
  });

  it('rejects forged cursors and the old URL-encoded format', () => {
    const forged = [
      'forged',
      'x~nope',
      '%E0%A4%A~' + id,
      `ann%20lee~${id}`,
      btoa(JSON.stringify(['ann', 'not-a-uuid'])),
      btoa(JSON.stringify({ sort_name: 'ann', id })),
      btoa(JSON.stringify(['ann', id, 'extra'])),
    ];
    for (const bad of forged) expect(decodePeopleCursor(bad)).toBeNull();
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
