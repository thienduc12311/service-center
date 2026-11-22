import { describe, expect, it } from 'vitest';
import { createPlanItemSchema } from '../schemas/plan.js';
import { itemIdsAfterDrop, itemsInOrder, parseQuickAddLine, quickAddRequest, type QuickAddEntry } from './plan-order-editing.js';

const item = (title: string, lengthSeconds: number | null): QuickAddEntry => ({ itemType: 'item', title, lengthSeconds });

describe('parseQuickAddLine', () => {
  it.each([
    ['Welcome 3:00', item('Welcome', 180)],
    ['Sermon 35:00', item('Sermon', 2100)],
    ['Long concert 1:02:03', item('Long concert', 3723)],
    ['Announcements 5m', item('Announcements', 300)],
    ['Announcements 5min', item('Announcements', 300)],
    ['Prayer 90s', item('Prayer', 90)],
    ['Prayer 45sec', item('Prayer', 45)],
    ['Offering 2m30s', item('Offering', 150)],
    ['Concert 1h', item('Concert', 3600)],
    ['Concert 1h30m', item('Concert', 5400)],
    ['Welcome 0:00', item('Welcome', 0)],
    ['  Welcome   4:45  ', item('Welcome', 285)],
    ['Welcome - 3:00', item('Welcome', 180)],
    ['Welcome, 3:00', item('Welcome', 180)],
    ['Announcements 5M', item('Announcements', 300)],
  ])('reads %j as an item with a length', (line, entry) => {
    expect(parseQuickAddLine(line)).toEqual({ ok: true, entry });
  });

  it.each([
    ['Announcements', item('Announcements', null)],
    ['Call to worship', item('Call to worship', null)],
    ['Psalm 23', item('Psalm 23', null)],
    ['Psalm 23 2:00', item('Psalm 23', 120)],
    ['Top 10 moments', item('Top 10 moments', null)],
    ['John 3:16 5:00', item('John 3:16', 300)],
    ['Acts 2:1-4', item('Acts 2:1-4', null)],
    ['Room 5b', item('Room 5b', null)],
    ['Prayer -5m', item('Prayer -5m', null)],
  ])('keeps %j in the title when its last word is not a length', (line, entry) => {
    expect(parseQuickAddLine(line)).toEqual({ ok: true, entry });
  });

  it.each([
    ['# Worship', 'Worship'],
    ['#Worship', 'Worship'],
    ['## Response 3:00', 'Response 3:00'],
    ['  #  Sermon series 2  ', 'Sermon series 2'],
  ])('reads %j as a header without a length', (line, title) => {
    expect(parseQuickAddLine(line)).toEqual({ ok: true, entry: { itemType: 'header', title, lengthSeconds: null } });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['#', 'titleRequired'],
    ['#   ', 'titleRequired'],
    ['3:00', 'titleRequired'],
    ['5m', 'titleRequired'],
    [' - 3:00', 'titleRequired'],
    ['Welcome 3:75', 'lengthFormat'],
    ['Welcome 1:60', 'lengthFormat'],
    ['Welcome 1:99:00', 'lengthFormat'],
    ['Welcome 1:00:00:00', 'lengthFormat'],
    ['Retreat 11h', 'lengthRange'],
    ['Retreat 10:00:01', 'lengthRange'],
    [`${'x'.repeat(201)}`, 'titleTooLong'],
    [`# ${'x'.repeat(201)}`, 'titleTooLong'],
    [`${'x'.repeat(201)} 3:00`, 'titleTooLong'],
  ])('refuses %j (%s)', (line, problem) => {
    expect(parseQuickAddLine(line)).toEqual({ ok: false, problem });
  });

  it('accepts the longest allowed length and title', () => {
    expect(parseQuickAddLine('Retreat 10h')).toEqual({ ok: true, entry: item('Retreat', 36_000) });
    expect(parseQuickAddLine('x'.repeat(200))).toEqual({ ok: true, entry: item('x'.repeat(200), null) });
  });
});

describe('quickAddRequest', () => {
  it('builds a body the add endpoint accepts', () => {
    const body = quickAddRequest(item('Welcome', 180));
    expect(body).toEqual({ item_type: 'item', title: 'Welcome', length_seconds: 180 });
    expect(createPlanItemSchema.safeParse(body).success).toBe(true);
  });

  it('sends zero for an item without a length and for a header', () => {
    expect(quickAddRequest(item('Announcements', null)).length_seconds).toBe(0);
    const header = quickAddRequest({ itemType: 'header', title: 'Worship', lengthSeconds: null });
    expect(header).toEqual({ item_type: 'header', title: 'Worship', length_seconds: 0 });
    expect(createPlanItemSchema.safeParse(header).success).toBe(true);
  });
});

describe('itemIdsAfterDrop', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves an item down or up to where it was dropped', () => {
    expect(itemIdsAfterDrop(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(itemIdsAfterDrop(ids, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
    expect(itemIdsAfterDrop(ids, 'b', 'c')).toEqual(['a', 'c', 'b', 'd']);
  });

  it('is null when nothing moves or an id is unknown', () => {
    expect(itemIdsAfterDrop(ids, 'b', 'b')).toBeNull();
    expect(itemIdsAfterDrop(ids, 'x', 'b')).toBeNull();
    expect(itemIdsAfterDrop(ids, 'b', 'x')).toBeNull();
  });

  it('does not change the order it was given', () => {
    itemIdsAfterDrop(ids, 'a', 'd');
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('itemsInOrder', () => {
  const items = [
    { id: 'a', sort_order: 0, title: 'A' },
    { id: 'b', sort_order: 1, title: 'B' },
    { id: 'c', sort_order: 5, title: 'C' },
  ];

  it('rearranges the items and renumbers their positions', () => {
    expect(itemsInOrder(items, ['c', 'a', 'b'])).toEqual([
      { id: 'c', sort_order: 0, title: 'C' },
      { id: 'a', sort_order: 1, title: 'A' },
      { id: 'b', sort_order: 2, title: 'B' },
    ]);
  });

  it('keeps the order when the ids are not the same set of items', () => {
    expect(itemsInOrder(items, ['a', 'b'])).toEqual(items);
    expect(itemsInOrder(items, ['a', 'b', 'x'])).toEqual(items);
    expect(itemsInOrder(items, ['a', 'a', 'b'])).toEqual(items);
  });
});
