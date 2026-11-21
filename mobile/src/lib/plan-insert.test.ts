import { describe, expect, it } from 'vitest';
import { cursorAfterFailed, cursorAfterPlaced, insertStep, orderWithInserted, type InsertCursor } from './plan-insert';

describe('orderWithInserted', () => {
  it('moves the appended item right after the anchor', () => {
    expect(orderWithInserted(['a', 'b', 'c', 'new'], 'a', 'new')).toEqual(['a', 'new', 'b', 'c']);
    // Works whether or not the order already lists the new item.
    expect(orderWithInserted(['a', 'b', 'c'], 'b', 'new')).toEqual(['a', 'b', 'new', 'c']);
  });

  it('needs no request when the anchor is last, and cannot place after a missing anchor', () => {
    expect(orderWithInserted(['a', 'b', 'new'], 'b', 'new')).toBeNull();
    expect(orderWithInserted(['a', 'b'], 'gone', 'new')).toBeNull();
  });
});

describe('insertStep across several adds in one visit', () => {
  it('appends without a reorder when no insert point was chosen', () => {
    expect(insertStep({ afterItemId: null, order: ['a'] }, 'n1')).toEqual({
      kind: 'none',
      placement: 'end',
      cursor: { afterItemId: null, order: ['a', 'n1'] },
    });
  });

  it('places songs after the chosen item in the order they were added', () => {
    let cursor: InsertCursor = { afterItemId: 'a', order: ['a', 'b', 'c'] };
    const first = insertStep(cursor, 'n1');
    expect(first).toEqual({ kind: 'reorder', itemIds: ['a', 'n1', 'b', 'c'] });
    cursor = cursorAfterPlaced('n1', ['a', 'n1', 'b', 'c']);
    // The next song follows the one just added, not the original anchor.
    expect(insertStep(cursor, 'n2')).toEqual({ kind: 'reorder', itemIds: ['a', 'n1', 'n2', 'b', 'c'] });
  });

  it('counts an anchor that is already last as placed, and the next add follows the new item', () => {
    const step = insertStep({ afterItemId: 'c', order: ['a', 'b', 'c'] }, 'n1');
    expect(step).toEqual({ kind: 'none', placement: 'placed', cursor: { afterItemId: 'n1', order: ['a', 'b', 'c', 'n1'] } });
  });

  it('falls back to appending when the anchor is gone or the reorder was refused', () => {
    expect(insertStep({ afterItemId: 'gone', order: ['a'] }, 'n1')).toEqual({
      kind: 'none',
      placement: 'failed',
      cursor: { afterItemId: null, order: ['a', 'n1'] },
    });
    expect(cursorAfterFailed({ afterItemId: 'a', order: ['a', 'b'] }, 'n1')).toEqual({ afterItemId: null, order: ['a', 'b', 'n1'] });
  });
});
