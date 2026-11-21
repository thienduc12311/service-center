import { describe, expect, it } from 'vitest';
import { chunk } from './chunk.js';

describe('chunk', () => {
  it('splits into bounded consecutive slices', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
    expect(chunk(Array.from({ length: 201 }, (_, i) => i)).map((slice) => slice.length)).toEqual([100, 100, 1]);
  });
});
