import { describe, expect, it } from 'vitest';
import type { SongListItem } from '@service-center/shared';
import {
  NO_SONG_FILTERS,
  activeSongFilterCount,
  isRecentlyUsed,
  songAddDraft,
  songAge,
  songBrowserQuery,
  themeSuggestions,
  weeksBefore,
  type SongBrowserContext,
} from './song-browser';

const openedAt = '2026-11-21T12:00:00.000Z';
const context: SongBrowserContext = { planId: 'plan-1', serviceTypeId: 'sunday', openedAt };

describe('songBrowserQuery', () => {
  it('Suggested: this service type\'s last 12 weeks, most used first, in-plan marks', () => {
    expect(songBrowserQuery({ tab: 'suggested', filters: NO_SONG_FILTERS, search: '', context })).toEqual({
      archive: 'active',
      plan_id: 'plan-1',
      sort: 'most_used',
      service_type_id: 'sunday',
      scheduled_from: '2026-08-29T12:00:00.000Z',
    });
  });

  it('Suggested is church-wide when the plan has no service type', () => {
    const query = songBrowserQuery({ tab: 'suggested', filters: NO_SONG_FILTERS, search: '', context: { ...context, serviceTypeId: null } });
    expect(query.service_type_id).toBeUndefined();
    expect(query.scheduled_from).toBe(weeksBefore(openedAt, 12));
  });

  it('a search in Suggested looks through the whole library, still most used first', () => {
    const query = songBrowserQuery({ tab: 'suggested', filters: NO_SONG_FILTERS, search: '  amazing grace ', context });
    expect(query).toMatchObject({ q: 'amazing grace', sort: 'most_used', service_type_id: 'sunday' });
    expect(query.scheduled_from).toBeUndefined();
  });

  it('Recently added and A–Z sort the library without the rotation window', () => {
    expect(songBrowserQuery({ tab: 'recent', filters: NO_SONG_FILTERS, search: '', context })).toEqual({
      archive: 'active', plan_id: 'plan-1', sort: 'recent', service_type_id: 'sunday',
    });
    expect(songBrowserQuery({ tab: 'title', filters: NO_SONG_FILTERS, search: '', context }).sort).toBe('title');
  });

  it('maps each filter chip to its parameter; "hide used" looks back 3 weeks', () => {
    const filters = { key: 'G', speed: 'Slow', theme: 'Grace', hideRecentlyUsed: true };
    expect(songBrowserQuery({ tab: 'title', filters, search: '', context })).toMatchObject({
      key: 'G',
      speed: 'Slow',
      theme: 'Grace',
      not_scheduled_since: '2026-10-31T12:00:00.000Z',
    });
    expect(activeSongFilterCount(filters)).toBe(4);
    expect(activeSongFilterCount(NO_SONG_FILTERS)).toBe(0);
  });
});

describe('isRecentlyUsed (soft warning)', () => {
  const planDate = '2026-11-29T09:00:00.000Z';
  it('warns within two weeks either side of the plan date', () => {
    expect(isRecentlyUsed('2026-11-22T09:00:00.000Z', planDate)).toBe(true);
    expect(isRecentlyUsed('2026-11-15T09:00:00.000Z', planDate)).toBe(true);
    expect(isRecentlyUsed('2026-12-06T09:00:00.000Z', planDate)).toBe(true);
  });
  it('stays quiet past two weeks, for never-used songs and unreadable dates', () => {
    expect(isRecentlyUsed('2026-11-14T08:59:00.000Z', planDate)).toBe(false);
    expect(isRecentlyUsed(null, planDate)).toBe(false);
    expect(isRecentlyUsed('not a date', planDate)).toBe(false);
  });
});

describe('songAge', () => {
  it('reads in the coarsest natural unit', () => {
    expect(songAge('2026-11-21T08:00:00.000Z', openedAt)).toEqual({ unit: 'today' });
    expect(songAge('2026-11-16T12:00:00.000Z', openedAt)).toEqual({ unit: 'days', count: 5 });
    expect(songAge('2026-10-31T12:00:00.000Z', openedAt)).toEqual({ unit: 'weeks', count: 3 });
    expect(songAge('2026-07-21T12:00:00.000Z', openedAt)).toEqual({ unit: 'months', count: 4 });
    expect(songAge('2024-11-01T12:00:00.000Z', openedAt)).toEqual({ unit: 'years', count: 2 });
  });
  it('says upcoming when its latest plan is still ahead, but later today is today', () => {
    expect(songAge('2026-11-28T12:00:00.000Z', openedAt)).toEqual({ unit: 'upcoming' });
    expect(songAge('2026-11-21T18:00:00.000Z', openedAt)).toEqual({ unit: 'today' });
  });
});

describe('themeSuggestions', () => {
  it('offers distinct themes from loaded songs that match the typed text, A–Z', () => {
    const songs = [{ themes: ['Grace', 'Cross'] }, { themes: ['grace', 'Ân điển'] }, { themes: [] }];
    expect(themeSuggestions(songs, '')).toEqual(['Ân điển', 'Cross', 'Grace']);
    expect(themeSuggestions(songs, 'an dien')).toEqual(['Ân điển']);
    expect(themeSuggestions(songs, '', 1)).toHaveLength(1);
  });
});

describe('songAddDraft', () => {
  const song = (arrangements: Partial<SongListItem['arrangements'][number]>[], defaultKey: string | null) =>
    ({ id: 's1', title: 'Song', default_key: defaultKey, arrangements }) as unknown as SongListItem;

  it('starts on the default arrangement\'s key, else the song\'s key', () => {
    expect(songAddDraft(song([{ id: 'a1', is_default: true, archived_at: null, song_key: 'Bb' }], 'G')).keyOverride).toBe('Bb');
    expect(songAddDraft(song([], 'G')).keyOverride).toBe('G');
    expect(songAddDraft(song([], null))).toMatchObject({ itemType: 'song', keyOverride: null, title: '' });
  });
});
