import { describe, expect, it } from 'vitest';
import type { ArrangementRow } from '../types/database.js';
import type { SongWithArrangements } from '../types/domain.js';
import {
  renderChartContext,
  resolveChartContext,
  type ChartContextPlanItem,
  type ChartContextReady,
} from './chart-context.js';

const SONG_ID = '00000000-0000-4000-8000-000000000001';

const arrangement = (overrides: Partial<ArrangementRow>): ArrangementRow => ({
  id: 'arr',
  song_id: SONG_ID,
  name: 'Arrangement',
  song_key: 'C',
  capo: null,
  bpm: null,
  meter: null,
  length_seconds: null,
  sequence: [],
  chord_chart: '[C]Amazing [G]grace',
  chord_chart_format: 'chordpro',
  chart_columns: 1,
  chart_font: null,
  chart_font_size: null,
  chart_chord_color: null,
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

/** Song default is arrangement A in C; arrangement B is a different version in G. */
const song = (arrangements?: ArrangementRow[]): SongWithArrangements => ({
  id: SONG_ID,
  organization_id: 'org',
  title: 'Amazing Grace',
  author: null,
  ccli_number: null,
  copyright: null,
  administration: null,
  default_key: 'C',
  default_bpm: null,
  meter: null,
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  arrangements: arrangements ?? [
    arrangement({ id: 'arr-a', name: 'Default', is_default: true, sequence: ['V1', 'C'] }),
    arrangement({
      id: 'arr-b',
      name: 'Acoustic',
      song_key: 'G',
      sequence: ['Intro', 'V1', 'C', 'C'],
      chord_chart: '[G]Amazing [D]grace',
    }),
  ],
});

const item = (overrides: Partial<ChartContextPlanItem> = {}): ChartContextPlanItem => ({
  id: 'item',
  item_type: 'song',
  song_id: SONG_ID,
  arrangement_id: 'arr-b',
  key_override: 'A',
  ...overrides,
});

const ready = (context: ReturnType<typeof resolveChartContext>): ChartContextReady => {
  if (context.status !== 'ready') throw new Error(`expected ready, got ${context.reason}`);
  return context;
};

describe('resolveChartContext', () => {
  it("uses the plan item's non-default arrangement, key override and sequence", () => {
    const context = ready(resolveChartContext({ song: song(), planItem: item() }));
    expect(context.source).toBe('plan');
    expect(context.arrangement?.id).toBe('arr-b');
    expect(context.sourceKey).toBe('G');
    expect(context.displayKey).toBe('A');
    expect(context.keyFromPlan).toBe(true);
    expect(context.sequence).toEqual(['Intro', 'V1', 'C', 'C']);
    expect(context.isTemporaryView).toBe(false);
  });

  it('falls back to the arrangement key, then the song default arrangement, only when unset', () => {
    const noOverride = ready(
      resolveChartContext({ song: song(), planItem: item({ key_override: null }) }),
    );
    expect(noOverride.displayKey).toBe('G');
    expect(noOverride.keyFromPlan).toBe(false);

    const noArrangement = ready(
      resolveChartContext({ song: song(), planItem: item({ arrangement_id: null, key_override: 'D' }) }),
    );
    expect(noArrangement.arrangement?.id).toBe('arr-a');
    expect(noArrangement.displayKey).toBe('D');
  });

  it('starts the library at the default arrangement and honours a picked one', () => {
    const initial = ready(resolveChartContext({ song: song() }));
    expect(initial.source).toBe('library');
    expect(initial.arrangement?.id).toBe('arr-a');
    expect(initial.displayKey).toBe('C');

    const picked = ready(resolveChartContext({ song: song(), viewArrangementId: 'arr-b' }));
    expect(picked.arrangement?.id).toBe('arr-b');
    expect(picked.displayKey).toBe('G');
    expect(picked.sequence).toEqual(['Intro', 'V1', 'C', 'C']);
  });

  it('marks a different arrangement viewed in plan context as temporary, keeping the plan arrangement', () => {
    const context = ready(
      resolveChartContext({ song: song(), planItem: item(), viewArrangementId: 'arr-a' }),
    );
    expect(context.arrangement?.id).toBe('arr-a');
    expect(context.planArrangement?.id).toBe('arr-b');
    expect(context.isTemporaryView).toBe(true);
    // The service key still applies to whichever version is being read.
    expect(context.displayKey).toBe('A');
    expect(context.sourceKey).toBe('C');
  });

  it('ignores a picked arrangement id that is not this song’s', () => {
    const context = ready(resolveChartContext({ song: song(), viewArrangementId: 'elsewhere' }));
    expect(context.arrangement?.id).toBe('arr-a');
  });

  it('shows a missing or deleted arrangement as unavailable instead of substituting the default', () => {
    expect(
      resolveChartContext({ song: song(), planItem: item({ arrangement_id: 'deleted' }) }),
    ).toEqual({ status: 'unavailable', reason: 'arrangement_missing' });
  });

  it('rejects an item that belongs to another song or is not a song item', () => {
    expect(
      resolveChartContext({ song: song(), planItem: item({ song_id: 'another-song' }) }),
    ).toEqual({ status: 'unavailable', reason: 'song_mismatch' });
    expect(
      resolveChartContext({ song: song(), planItem: item({ item_type: 'header', song_id: null }) }),
    ).toEqual({ status: 'unavailable', reason: 'not_a_song' });
  });

  it('resolves each context independently, so the same song keeps each plan’s own key', () => {
    const planOne = ready(resolveChartContext({ song: song(), planItem: item() }));
    const planTwo = ready(
      resolveChartContext({
        song: song(),
        planItem: item({ id: 'other', arrangement_id: 'arr-a', key_override: 'D' }),
      }),
    );
    const library = ready(resolveChartContext({ song: song() }));
    expect([planOne.displayKey, planTwo.displayKey, library.displayKey]).toEqual(['A', 'D', 'C']);
    expect(planTwo.sequence).toEqual(['V1', 'C']);
  });
});

describe('resolveChartContext — F11 plan sequence', () => {
  it('uses the item sequence override; null inherits; another item on the same song is independent', () => {
    const own = ready(resolveChartContext({ song: song(), planItem: item({ sequence_override: ['C', 'C'] }) }));
    expect(own.sequence).toEqual(['C', 'C']);
    expect(own.sequenceFromPlan).toBe(true);

    const inherits = ready(resolveChartContext({ song: song(), planItem: item({ id: 'two', sequence_override: null, key_override: 'B' }) }));
    expect(inherits.sequence).toEqual(['Intro', 'V1', 'C', 'C']);
    expect(inherits.sequenceFromPlan).toBe(false);
    expect([own.displayKey, inherits.displayKey]).toEqual(['A', 'B']);
  });

  it('treats an empty override as "no sequence for this plan", not as inherit', () => {
    const empty = ready(resolveChartContext({ song: song(), planItem: item({ sequence_override: [] }) }));
    expect(empty.sequence).toEqual([]);
    expect(empty.sequenceFromPlan).toBe(true);
  });

  it('shows the viewed arrangement’s own sequence in a temporary view', () => {
    const viewing = ready(resolveChartContext({ song: song(), planItem: item({ sequence_override: ['C'] }), viewArrangementId: 'arr-a' }));
    expect(viewing.sequence).toEqual(['V1', 'C']);
    expect(viewing.sequenceFromPlan).toBe(false);
  });
});

describe('renderChartContext', () => {
  it('renders a C-source arrangement in a D service key, chords and label together', () => {
    const context = ready(
      resolveChartContext({ song: song(), planItem: item({ arrangement_id: 'arr-a', key_override: 'D' }) }),
    );
    const chart = renderChartContext(context);
    expect(chart).toMatchObject({ status: 'ready', key: 'D', chordpro: '[D]Amazing [A]grace' });
  });

  it('applies the reader’s shift once, on top of the service key', () => {
    const context = ready(
      resolveChartContext({ song: song(), planItem: item({ arrangement_id: 'arr-a', key_override: 'D' }) }),
    );
    expect(renderChartContext(context, { semitones: 2 })).toMatchObject({
      key: 'E',
      chordpro: '[E]Amazing [B]grace',
    });
    expect(renderChartContext(context, { semitones: -1 })).toMatchObject({
      key: 'Db',
      chordpro: '[Db]Amazing [Ab]grace',
    });
  });

  it('keeps numbers relative to the written key regardless of the service key', () => {
    const context = ready(resolveChartContext({ song: song(), planItem: item() }));
    expect(renderChartContext(context, { notation: 'numbers' })).toMatchObject({
      status: 'ready',
      key: null,
      chordpro: '[1]Amazing [5]grace',
    });
  });

  it('reports a missing chart explicitly', () => {
    const context = ready(
      resolveChartContext({ song: song([arrangement({ id: 'x', chord_chart: null, is_default: true })]) }),
    );
    expect(renderChartContext(context)).toEqual({ status: 'unavailable', reason: 'no_chart' });
  });

  it('refuses to label chords with a key it cannot transpose from', () => {
    const unkeyed: SongWithArrangements = {
      ...song([arrangement({ id: 'x', song_key: null, is_default: true })]),
      default_key: null,
    };

    const asWritten = ready(resolveChartContext({ song: unkeyed }));
    expect(renderChartContext(asWritten)).toMatchObject({
      status: 'ready',
      key: null,
      chordpro: '[C]Amazing [G]grace',
    });
    expect(renderChartContext(asWritten, { semitones: 1 })).toEqual({
      status: 'unavailable',
      reason: 'key_unknown',
    });
    expect(renderChartContext(asWritten, { notation: 'numerals' })).toEqual({
      status: 'unavailable',
      reason: 'key_unknown',
    });

    const overridden = ready(
      resolveChartContext({ song: unkeyed, planItem: item({ arrangement_id: 'x', key_override: 'D' }) }),
    );
    expect(renderChartContext(overridden)).toEqual({ status: 'unavailable', reason: 'key_unknown' });
    expect(renderChartContext(overridden, { notation: 'lyrics' })).toMatchObject({
      status: 'ready',
      chordpro: 'Amazing grace',
    });
  });
});
