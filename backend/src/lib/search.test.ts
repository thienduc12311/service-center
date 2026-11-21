import { describe, expect, it } from 'vitest';
import { literalSearchPattern, whereSearchMatches, type RawQuery } from './search.js';
import { peopleKeysetFilter, quoteFilterValue } from './keyset.js';

/** Records `.filter()` calls the way a PostgREST builder chains them. */
const recorder = (): { builder: RawQuery; calls: Array<[string, string, unknown]> } => {
  const calls: Array<[string, string, unknown]> = [];
  const builder = {
    filter(column: string, operator: string, value: unknown) {
      calls.push([column, operator, value]);
      return builder;
    },
  };
  return { builder: builder as unknown as RawQuery, calls };
};

describe('whereSearchMatches', () => {
  it('adds one folded, literal imatch per word (AND)', () => {
    const { builder, calls } = recorder();
    whereSearchMatches(builder, '  Nguyễn   ĐỨC ');
    expect(calls).toEqual([
      ['search_text', 'imatch', 'nguyen'],
      ['search_text', 'imatch', 'duc'],
    ]);
  });

  it('escapes regex and LIKE wildcards so they match themselves', () => {
    const { builder, calls } = recorder();
    whereSearchMatches(builder, '50% a_b c\\d e*f (g)');
    expect(calls.map(([, , value]) => value)).toEqual(['50\\%', 'a\\_b', 'c\\\\d', 'e\\*f', '\\(g\\)']);
  });

  it('leaves the query alone for a blank search', () => {
    const { builder, calls } = recorder();
    expect(whereSearchMatches(builder, '   ')).toBe(builder);
    whereSearchMatches(builder, undefined);
    expect(calls).toEqual([]);
  });

  it('keeps letters of any script and digits unescaped', () => {
    expect(literalSearchPattern('chúa123 привет')).toBe('chúa123 привет');
  });
});

describe('peopleKeysetFilter', () => {
  const cursor = { sort_name: 'nguyễn "a", (b)', id: '00000000-0000-4000-8000-000000000001' };

  it('reads strictly after or before (sort_name, id), quoting the name', () => {
    const name = quoteFilterValue(cursor.sort_name);
    expect(name).toBe('"nguyễn \\"a\\", (b)"');
    expect(peopleKeysetFilter(cursor, 'after')).toBe(`sort_name.gt.${name},and(sort_name.eq.${name},id.gt.${cursor.id})`);
    expect(peopleKeysetFilter(cursor, 'before')).toBe(`sort_name.lt.${name},and(sort_name.eq.${name},id.lt.${cursor.id})`);
  });
});
