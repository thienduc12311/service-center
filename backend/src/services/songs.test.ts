import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import type { ArrangementRow, SongWithArrangements } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import { attachLastScheduled, loadArrangementChart, loadSongSchedule } from './songs.js';

const song = (id: string): SongWithArrangements => ({
  id,
  organization_id: 'org',
  title: id,
  author: null,
  ccli_number: null,
  copyright: null,
  administration: null,
  default_key: 'G',
  default_bpm: null,
  meter: null,
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  arrangements: [],
});

/** Resolves any chain of PostgREST builder calls to a fixed result. */
const fakeDb = <T>(result: T): Db => {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: T; error: null }) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve),
  };
  for (const method of ['from', 'select', 'in', 'eq', 'order', 'limit', 'maybeSingle']) {
    builder[method] = () => builder;
  }
  return builder as unknown as Db;
};

describe('attachLastScheduled', () => {
  it('takes the latest service date each song appears in', async () => {
    const db = fakeDb([
      { song_id: 'a', plan: { service_date: '2026-06-14T10:00:00.000Z' } },
      { song_id: 'a', plan: { service_date: '2026-08-16T10:00:00.000Z' } },
      { song_id: 'b', plan: { service_date: '2026-07-05T10:00:00.000Z' } },
    ]);

    const rows = await attachLastScheduled(db, [song('a'), song('b'), song('c')]);

    expect(rows.map((row) => row.last_scheduled_at)).toEqual([
      '2026-08-16T10:00:00.000Z',
      '2026-07-05T10:00:00.000Z',
      null,
    ]);
  });

  it('skips the query entirely for an empty page', async () => {
    const db = fakeDb(null);
    await expect(attachLastScheduled(db, [])).resolves.toEqual([]);
  });
});

describe('loadSongSchedule', () => {
  it('maps each plan to one entry, preferring the key the plan was played in', async () => {
    const db = fakeDb([
      {
        id: 'plan-1',
        title: 'Sunday Service',
        service_date: '2026-06-14T10:00:00.000Z',
        service_type: { name: 'Sunday Service' },
        items: [
          {
            arrangement_id: 'arr-1',
            key_override: 'D',
            arrangement: { id: 'arr-1', name: 'Citipointe Worship', song_key: 'G' },
          },
        ],
      },
    ]);

    await expect(loadSongSchedule(db, 'song-1', 'org', { limit: 3 })).resolves.toEqual([
      {
        plan_id: 'plan-1',
        plan_title: 'Sunday Service',
        service_date: '2026-06-14T10:00:00.000Z',
        service_type_name: 'Sunday Service',
        arrangement_id: 'arr-1',
        arrangement_name: 'Citipointe Worship',
        key: 'D',
      },
    ]);
  });

  it('falls back to the arrangement key, and tolerates a plan item with no arrangement', async () => {
    const db = fakeDb([
      {
        id: 'plan-2',
        title: 'Christmas Eve',
        service_date: '2026-12-24T18:00:00.000Z',
        service_type: null,
        items: [{ arrangement_id: null, key_override: null, arrangement: null }],
      },
    ]);

    const [entry] = await loadSongSchedule(db, 'song-1', 'org', { limit: 3 });

    expect(entry).toMatchObject({
      service_type_name: null,
      arrangement_id: null,
      arrangement_name: null,
      key: null,
    });
  });

  it('answers with an empty list when the song has never been scheduled', async () => {
    await expect(loadSongSchedule(fakeDb(null), 'song-1', 'org', { limit: 3 })).resolves.toEqual([]);
  });
});

describe('loadArrangementChart', () => {
  const arrangement = (overrides: Partial<ArrangementRow> = {}) =>
    fakeDb({ id: 'arr', song_key: 'G', chord_chart: '[G]Hello [D7]world', ...overrides });

  it('transposes to the requested key', async () => {
    const chart = await loadArrangementChart(arrangement(), 'arr', {
      to: 'A',
      notation: 'chords',
    });

    expect(chart.chordpro).toBe('[A]Hello [E7]world');
    expect(chart.key).toBe('A');
    expect(chart.semitones).toBe(2);
  });

  it('converts to numbers without transposing', async () => {
    const chart = await loadArrangementChart(arrangement(), 'arr', {
      to: 'A',
      notation: 'numbers',
    });

    expect(chart.chordpro).toBe('[1]Hello [57]world');
    expect(chart.key).toBeNull();
  });

  it('answers with an empty chart when the arrangement has none', async () => {
    const chart = await loadArrangementChart(arrangement({ chord_chart: null }), 'arr', {
      notation: 'chords',
    });

    expect(chart).toEqual({ chordpro: '', key: 'G', semitones: 0, notation: 'chords' });
  });

  it('refuses to transpose an arrangement with no key', async () => {
    await expect(
      loadArrangementChart(arrangement({ song_key: null }), 'arr', { to: 'A', notation: 'chords' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s when the arrangement is missing or hidden by RLS', async () => {
    await expect(
      loadArrangementChart(fakeDb(null), 'arr', { notation: 'chords' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
