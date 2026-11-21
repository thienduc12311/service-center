import { describe, expect, it } from 'vitest';
import { EMPTY_SONG_BROWSER_FILTERS, activeSongFilterCount, isRecentlyUsed, songBrowserQuery, usageAge } from './songBrowser';
import { orderWithInsertedItem, advanceInsertPoint } from './insertPoint';

const NOW = new Date('2026-11-21T12:00:00Z');
const context = { planId: 'plan-1', serviceTypeId: 'sunday', now: NOW };

describe('songBrowserQuery', () => {
  it('asks for the service type rotation of the last 12 weeks, most used first, marking songs in this plan', () => {
    expect(songBrowserQuery({ ...context, tab: 'suggested', q: '', filters: EMPTY_SONG_BROWSER_FILTERS })).toEqual({
      sort: 'most_used',
      plan_id: 'plan-1',
      per_page: 20,
      service_type_id: 'sunday',
      scheduled_from: '2026-08-29T12:00:00.000Z',
    });
  });

  it('falls back to the church-wide rotation when the plan has no service type', () => {
    const query = songBrowserQuery({ ...context, serviceTypeId: null, tab: 'suggested', q: '', filters: EMPTY_SONG_BROWSER_FILTERS });
    expect(query).not.toHaveProperty('service_type_id');
    expect(query.scheduled_from).toBe('2026-08-29T12:00:00.000Z');
  });

  it('searches the whole library in the tab order and maps every filter chip', () => {
    const query = songBrowserQuery({
      ...context,
      tab: 'suggested',
      q: '  chua la  ',
      filters: { key: 'G', speed: 'Slow', theme: ' Grace ', songType: 'Hymn', hideRecent: true },
    });
    expect(query).not.toHaveProperty('scheduled_from');
    expect(query).toMatchObject({
      sort: 'most_used',
      q: 'chua la',
      key: 'G',
      speed: 'Slow',
      theme: 'Grace',
      song_type: 'Hymn',
      not_scheduled_since: '2026-10-31T12:00:00.000Z',
    });
  });

  it('orders Recently added by creation and All by title', () => {
    expect(songBrowserQuery({ ...context, tab: 'recent', q: '', filters: EMPTY_SONG_BROWSER_FILTERS }).sort).toBe('recent');
    expect(songBrowserQuery({ ...context, tab: 'all', q: '', filters: EMPTY_SONG_BROWSER_FILTERS }).sort).toBe('title');
  });

  it('counts the chips that are set', () => {
    expect(activeSongFilterCount(EMPTY_SONG_BROWSER_FILTERS)).toBe(0);
    expect(activeSongFilterCount({ ...EMPTY_SONG_BROWSER_FILTERS, key: 'D', theme: '  ', hideRecent: true })).toBe(2);
  });
});

describe('song usage', () => {
  it('warns about songs sung within two weeks either side of the plan date', () => {
    const planDate = '2026-11-22T10:00:00Z';
    expect(isRecentlyUsed('2026-11-15T10:00:00Z', planDate)).toBe(true);
    expect(isRecentlyUsed('2026-11-29T10:00:00Z', planDate)).toBe(true);
    expect(isRecentlyUsed('2026-11-01T10:00:00Z', planDate)).toBe(false);
    expect(isRecentlyUsed(null, planDate)).toBe(false);
  });

  it('reads ages in the largest whole unit', () => {
    expect(usageAge('2026-11-21T08:00:00Z', NOW)).toEqual({ unit: 'today' });
    expect(usageAge('2026-11-18T12:00:00Z', NOW)).toEqual({ unit: 'days', count: 3 });
    expect(usageAge('2026-11-07T12:00:00Z', NOW)).toEqual({ unit: 'weeks', count: 2 });
    expect(usageAge('2026-07-21T12:00:00Z', NOW)).toEqual({ unit: 'months', count: 4 });
    expect(usageAge('2024-11-01T12:00:00Z', NOW)).toEqual({ unit: 'years', count: 2 });
    expect(usageAge('2026-11-29T12:00:00Z', NOW)).toEqual({ unit: 'upcoming' });
  });
});

describe('insert points', () => {
  it('moves the new item after the anchor, or to the start', () => {
    expect(orderWithInsertedItem(['a', 'b', 'c', 'new'], 'new', 'a')).toEqual(['a', 'new', 'b', 'c']);
    expect(orderWithInsertedItem(['a', 'b', 'new'], 'new', null)).toEqual(['new', 'a', 'b']);
  });

  it('sends nothing when the item is already there, missing, or the anchor is gone', () => {
    expect(orderWithInsertedItem(['a', 'b', 'new'], 'new', 'b')).toBeNull();
    expect(orderWithInsertedItem(['a', 'b'], 'new', 'a')).toBeNull();
    expect(orderWithInsertedItem(['a', 'new'], 'new', 'removed')).toBeNull();
  });

  it('follows each added item so several adds keep their order', () => {
    expect(advanceInsertPoint({ kind: 'after', itemId: 'a' }, 'new')).toEqual({ kind: 'after', itemId: 'new' });
    expect(advanceInsertPoint({ kind: 'end' }, 'new')).toEqual({ kind: 'end' });
  });
});
