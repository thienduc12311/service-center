import { describe, expect, it } from 'vitest';
import { FIRST_PAGE, hasPreviousPage, nextPage, pageNumber, previousPage } from './cursor-stack';

describe('cursor stack (staffing matrix people pages)', () => {
  it('starts on page 1 with nothing to go back to', () => {
    expect(FIRST_PAGE.current).toBeUndefined();
    expect(hasPreviousPage(FIRST_PAGE)).toBe(false);
    expect(pageNumber(FIRST_PAGE)).toBe(1);
  });

  it('remembers each cursor going forward and returns through them in order', () => {
    const second = nextPage(FIRST_PAGE, 'person-25');
    const third = nextPage(second, 'person-50');
    expect(third).toEqual({ current: 'person-50', previous: [undefined, 'person-25'] });
    expect(pageNumber(third)).toBe(3);

    const backToSecond = previousPage(third);
    expect(backToSecond.current).toBe('person-25');
    expect(pageNumber(backToSecond)).toBe(2);

    const backToFirst = previousPage(backToSecond);
    expect(backToFirst.current).toBeUndefined();
    expect(hasPreviousPage(backToFirst)).toBe(false);
  });

  it('stays on the first page when asked to go back from it', () => {
    expect(previousPage(FIRST_PAGE)).toBe(FIRST_PAGE);
  });

  it('can go forward again after going back, replacing the abandoned branch', () => {
    const third = nextPage(nextPage(FIRST_PAGE, 'a'), 'b');
    const again = nextPage(previousPage(third), 'c');
    expect(again).toEqual({ current: 'c', previous: [undefined, 'a'] });
  });
});
