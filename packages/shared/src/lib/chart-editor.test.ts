import { describe, expect, it } from 'vitest';
import type { ArrangementRow } from '../types/database.js';
import type { PlanDetail, PlanItemDetail, SongWithArrangements } from '../types/domain.js';
import { updateArrangementSchema } from '../schemas/song.js';
import { renderChartContext, resolveChartContext, resolvePlanItemChartContext } from './chart-context.js';
import { renderChartHtml } from './chart-html.js';
import { parseChordPro } from './chordpro.js';
import { serviceSongBookDocumentFromPlan } from './service-song-book.js';
import {
  ORIGINAL_CHART_VIEW,
  chartDocumentFrom,
  chartDocumentFromContext,
  chartEditorFormFrom,
  chartEditorIsDirty,
  chartEditorProblem,
  chartEditorTitleChanged,
  chartPdfFilename,
  toChartArrangementInput,
  toChartSongInput,
} from './chart-editor.js';

const arrangement = (overrides: Partial<ArrangementRow> = {}): ArrangementRow => ({
  id: 'arr-a',
  archived_at: null,
  revision: 4,
  song_id: 'song-1',
  name: 'Band',
  song_key: 'C',
  capo: null,
  bpm: 72,
  meter: '3/4',
  length_seconds: 275,
  sequence: ['V1', 'C'],
  chord_chart: '{c: Verse 1}\n[C]Amazing [F]grace how [G]sweet',
  chord_chart_format: 'chordpro',
  chart_columns: 2,
  chart_font: null,
  chart_font_size: 14,
  chart_chord_color: '#1d4ed8',
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const song = (overrides: Partial<SongWithArrangements> = {}): SongWithArrangements => ({
  id: 'song-1',
  archived_at: null,
  revision: 9,
  organization_id: 'org',
  title: 'Amazing Grace',
  author: 'John Newton',
  ccli_number: null,
  copyright: 'Public domain',
  administration: null,
  default_key: 'G',
  default_bpm: 72,
  meter: '3/4',
  themes: [],
  song_types: [],
  style: null,
  speed: null,
  notes: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  arrangements: [arrangement()],
  ...overrides,
});

/** Every chord written in a ChordPro chart, in order. */
const chordsOf = (chordpro: string): string[] => [...chordpro.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1] ?? '');

describe('chart editor form and save bodies', () => {
  it('opens on the arrangement as stored, falling back to the song key', () => {
    expect(chartEditorFormFrom(song(), arrangement())).toEqual({
      title: 'Amazing Grace',
      arrangementName: 'Band',
      songKey: 'C',
      sequence: ['V1', 'C'],
      source: '{c: Verse 1}\n[C]Amazing [F]grace how [G]sweet',
      formatting: { columns: 2, fontFamily: null, fontSize: 14, chordColor: '#1d4ed8' },
    });
    expect(chartEditorFormFrom(song(), arrangement({ song_key: null, chord_chart: null })).songKey).toBe('G');
    expect(chartEditorFormFrom(song(), arrangement({ chord_chart: null })).source).toBe('');
  });

  it('saves the chart as ChordPro with its layout and the revision it was opened at', () => {
    const values = { ...chartEditorFormFrom(song(), arrangement()), source: 'C        G\nAmazing grace' };
    const body = toChartArrangementInput(values, 'Default Arrangement', 4);
    expect(body).toMatchObject({
      name: 'Band',
      song_key: 'C',
      chord_chart_format: 'chordpro',
      chart_columns: 2,
      chart_font_size: 14,
      chart_chord_color: '#1d4ed8',
      expected_revision: 4,
    });
    // Chords typed over the words become inline ChordPro on the way out.
    expect(body.chord_chart).toContain('[C]');
    expect(body.chord_chart).toContain('[G]');
    expect(updateArrangementSchema.safeParse(body).success).toBe(true);
    // Without a revision the legacy (unchecked) contract is unchanged.
    expect(toChartArrangementInput(values, 'Default Arrangement')).not.toHaveProperty('expected_revision');
    expect(toChartSongInput({ ...values, title: ' New ' }, 9)).toEqual({ title: 'New', expected_revision: 9 });
  });

  it('falls back to the localized default name and is dirty only on a real change', () => {
    const saved = chartEditorFormFrom(song(), arrangement());
    expect(toChartArrangementInput({ ...saved, arrangementName: '  ' }, 'Bản phối mặc định').name).toBe('Bản phối mặc định');
    expect(chartEditorIsDirty({ ...saved }, saved)).toBe(false);
    expect(chartEditorIsDirty({ ...saved, source: `${saved.source} ` }, saved)).toBe(true);
    expect(chartEditorIsDirty({ ...saved, formatting: { ...saved.formatting, columns: 1 } }, saved)).toBe(true);
    expect(chartEditorTitleChanged(saved, saved)).toBe(false);
    expect(chartEditorTitleChanged({ ...saved, title: '  ' }, saved)).toBe(false);
    expect(chartEditorTitleChanged({ ...saved, title: 'Grace' }, saved)).toBe(true);
  });

  it('refuses what the API would refuse before anything is sent', () => {
    const saved = chartEditorFormFrom(song(), arrangement());
    expect(chartEditorProblem(saved, 'Default')).toBeNull();
    expect(chartEditorProblem({ ...saved, title: ' ' }, 'Default')).toBe('title_missing');
    expect(chartEditorProblem({ ...saved, source: 'x'.repeat(100_001) }, 'Default')).toBe('invalid');
    expect(chartEditorProblem({ ...saved, sequence: ['A very long section label'] }, 'Default')).toBe('invalid');
    expect(chartEditorProblem({ ...saved, sequence: Array.from({ length: 61 }, () => 'V') }, 'Default')).toBe('invalid');
  });
});

describe('chart document (preview and PDF)', () => {
  const values = chartEditorFormFrom(song(), arrangement());
  const base = { song: song(), untitledTitle: 'Untitled song', locale: 'en' as const };

  it('transposes exactly once: the heading key and every chord agree, in the preview and the PDF HTML', () => {
    const doc = chartDocumentFrom({ ...base, values, view: { targetKey: 'D', notation: 'chords' } });
    expect(doc.key).toBe('D');
    expect(chordsOf(doc.chordpro)).toEqual(['D', 'G', 'A']);
    // The preview parses the document's own ChordPro…
    const preview = parseChordPro(doc.chordpro).sections.flatMap((section) => section.lines.flatMap((line) => line.chords.map((chord) => chord.chord)));
    expect(preview).toEqual(['D', 'G', 'A']);
    // …and the PDF prints it as is: D/G/A, never moved again to E/A/B.
    const html = renderChartHtml(doc);
    expect(html).toContain('Amazing Grace [D]');
    const chordRows = [...html.matchAll(/<div class="chords">([^<]*)<\/div>/g)].map((match) => (match[1] ?? '').trim().split(/\s+/));
    expect(chordRows.flat()).toEqual(['D', 'G', 'A']);
  });

  it('reads the original key, numbers and a lyric sheet without a misleading key', () => {
    expect(chartDocumentFrom({ ...base, values, view: ORIGINAL_CHART_VIEW })).toMatchObject({ key: 'C', title: 'Amazing Grace', arrangementName: 'Band' });
    const numbers = chartDocumentFrom({ ...base, values, view: { targetKey: null, notation: 'numbers' } });
    expect(numbers.key).toBeNull();
    expect(chordsOf(numbers.chordpro)).toEqual(['1', '4', '5']);
    const lyrics = chartDocumentFrom({ ...base, values, view: { targetKey: 'D', notation: 'lyrics' } });
    expect(lyrics.key).toBeNull();
    expect(chordsOf(lyrics.chordpro)).toEqual([]);
  });

  it('keeps malformed input printable instead of failing', () => {
    const broken = { ...values, source: '[C Amazing [F]grace\n{c: unclosed\n[]\n[H#9] what' };
    const doc = chartDocumentFrom({ ...base, values: broken, view: { targetKey: 'D', notation: 'chords' } });
    expect(() => renderChartHtml(doc)).not.toThrow();
    expect(renderChartHtml(doc)).toContain('Amazing');
    expect(chartDocumentFrom({ ...base, values: { ...values, title: ' ' }, view: ORIGINAL_CHART_VIEW }).title).toBe('Untitled song');
  });

  it('builds a plan chart from the very render on screen: plan key, plan sequence, arrangement layout', () => {
    const item: PlanItemDetail = {
      id: 'item-1',
      plan_id: 'plan-1',
      item_type: 'song',
      title: 'Amazing Grace',
      song_id: 'song-1',
      arrangement_id: 'arr-a',
      key_override: 'D',
      length_seconds: 300,
      description: null,
      sort_order: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      song: { id: 'song-1', title: 'Amazing Grace', author: 'John Newton', copyright: 'Public domain', default_key: 'G', default_bpm: 72 },
      arrangement: { ...arrangement(), song_id: 'song-1' },
      sequence_override: ['C', 'V1', 'C'],
      leader_person_id: null,
      leader_position_id: null,
      service_segment: 'service',
    };
    const context = resolveChartContext({ song: song(), planItem: item });
    if (context.status !== 'ready') throw new Error('expected a ready context');
    const rendered = renderChartContext(context);
    const doc = chartDocumentFromContext({ song: song(), context, rendered, locale: 'en' });
    expect(doc).toMatchObject({
      key: 'D',
      sequence: ['C', 'V1', 'C'],
      arrangementName: 'Band',
      formatting: { columns: 2, fontSize: 14, chordColor: '#1d4ed8', fontFamily: null },
    });
    expect(chordsOf(doc?.chordpro ?? '')).toEqual(['D', 'G', 'A']);

    // The printed service song book reads the same item the same way.
    const book = serviceSongBookDocumentFromPlan({ plan: { items: [item], title: 'Sunday', service_date: '2026-08-16', location: null } as unknown as PlanDetail, organizationName: 'Org' });
    const bookSong = book.songs[0];
    const planItemContext = resolvePlanItemChartContext(item);
    if (planItemContext.status !== 'ready') throw new Error('expected a ready plan item context');
    const fromPlanItem = chartDocumentFromContext({ song: song(), context: planItemContext, rendered: renderChartContext(planItemContext), locale: 'en' });
    expect(fromPlanItem).toMatchObject({
      key: bookSong?.key,
      sequence: bookSong?.sequence,
      chordpro: bookSong?.chordpro,
      arrangementName: bookSong?.arrangementName,
      formatting: bookSong?.formatting,
    });

    // A reader's shift moves it once more, from the service key.
    const shifted = chartDocumentFromContext({ song: song(), context, rendered: renderChartContext(context, { semitones: 2 }), locale: 'en' });
    expect(shifted?.key).toBe('E');
    expect(chordsOf(shifted?.chordpro ?? '')).toEqual(['E', 'A', 'B']);
  });

  it('exports nothing that was not shown', () => {
    const empty = song({ arrangements: [arrangement({ chord_chart: '  ' })] });
    const context = resolveChartContext({ song: empty });
    if (context.status !== 'ready') throw new Error('expected a ready context');
    expect(chartDocumentFromContext({ song: empty, context, rendered: renderChartContext(context), locale: 'en' })).toBeNull();
  });

  it('names the file after the heading, safely', () => {
    expect(chartPdfFilename('Nothing Is Impossible [C]')).toBe('Nothing Is Impossible [C].pdf');
    expect(chartPdfFilename('AC/DC: "Live"?')).toBe('AC DC Live.pdf');
    expect(chartPdfFilename('...')).toBe('chord-chart.pdf');
  });
});
