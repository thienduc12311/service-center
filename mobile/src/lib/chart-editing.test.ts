import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHART_PAGE,
  chartDocumentFrom,
  chartEditorFormFrom,
  chartPdfFilename,
  type ArrangementRow,
  type SongWithArrangements,
} from '@service-center/shared';
import { AuthoringDraftStore, draftTargets } from './song-library';
import {
  CHART_PDF_PAGE,
  chartArrangementSaveBody,
  chartPdfName,
  chartPdfPrintOptions,
  formatChartSequence,
  isPrintDismissal,
  parseChartSequence,
} from './chart-editing';

const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

const arrangement = (overrides: Partial<ArrangementRow> = {}): ArrangementRow => ({
  id: 'arr-a',
  archived_at: null,
  revision: 5,
  song_id: 'song-1',
  name: 'Band',
  song_key: 'C',
  capo: null,
  bpm: 72,
  meter: '3/4',
  length_seconds: 275,
  sequence: ['V1', 'C'],
  chord_chart: '[C]Amazing [F]grace how [G]sweet',
  chord_chart_format: 'chordpro',
  chart_columns: 1,
  chart_font: null,
  chart_font_size: null,
  chart_chord_color: null,
  is_default: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const song = { title: 'Amazing Grace', default_key: 'G', author: 'John Newton', copyright: null } as Pick<
  SongWithArrangements,
  'title' | 'default_key' | 'author' | 'copyright'
>;

describe('native chart save', () => {
  it('sends one revisioned arrangement write with the chart as ChordPro', () => {
    const values = { ...chartEditorFormFrom(song, arrangement()), source: 'D        A\nAmazing grace', songKey: 'D' };
    const body = chartArrangementSaveBody(values, 5, 'Default Arrangement');
    expect(body).toMatchObject({ expected_revision: 5, song_key: 'D', chord_chart_format: 'chordpro', sequence: ['V1', 'C'] });
    expect(body.chord_chart).toContain('[D]');
    // The song title is not part of it: the app edits it in Song information.
    expect(body).not.toHaveProperty('title');
  });

  it('refuses before sending what the server would refuse', () => {
    const values = chartEditorFormFrom(song, arrangement());
    expect(() => chartArrangementSaveBody({ ...values, source: 'x'.repeat(100_001) }, 5, 'Default')).toThrow();
    expect(() => chartArrangementSaveBody({ ...values, sequence: ['Much too long a section'] }, 5, 'Default')).toThrow();
  });

  it('reads the sequence field the way the arrangement editor does', () => {
    expect(parseChartSequence(' Intro, V1,\nC1 ,, ')).toEqual(['Intro', 'V1', 'C1']);
    expect(formatChartSequence(['Intro', 'V1'])).toBe('Intro, V1');
    expect(parseChartSequence(formatChartSequence(['V1', 'C', 'V2']))).toEqual(['V1', 'C', 'V2']);
  });

  it('keeps chart drafts per identity and apart from the arrangement editor draft', () => {
    const drafts = new AuthoringDraftStore();
    const a = { generation: 1, userId: 'u1', organizationId: 'o1' };
    const values = chartEditorFormFrom(song, arrangement());
    expect(draftTargets.chart('arr-a')).not.toBe(draftTargets.arrangement('arr-a'));
    drafts.set(a, draftTargets.chart('arr-a'), { draft: values, baseRevision: 5, base: values });
    expect(drafts.get(a, draftTargets.chart('arr-a'))?.baseRevision).toBe(5);
    expect(drafts.get({ ...a, organizationId: 'o2' }, draftTargets.chart('arr-a'))).toBeNull();
    expect(drafts.get({ ...a, generation: 2 }, draftTargets.chart('arr-a'))).toBeNull();
  });
});

describe('native chart PDF', () => {
  const doc = chartDocumentFrom({
    values: chartEditorFormFrom(song, arrangement()),
    song,
    view: { targetKey: 'D', notation: 'chords' },
    untitledTitle: 'Untitled song',
    locale: 'en',
  });

  it('prints the shared document on the template’s own US Letter page, edge to edge', () => {
    expect(CHART_PDF_PAGE).toEqual({ width: CHART_PAGE.widthIn * 72, height: CHART_PAGE.heightIn * 72 });
    const options = chartPdfPrintOptions(doc);
    expect(options).toMatchObject({ width: 612, height: 792, margins: { top: 0, right: 0, bottom: 0, left: 0 } });
    expect(options.html).toContain('<title>Amazing Grace [D]</title>');
    // The pagination script travels with it, so the OS web view breaks pages as the website does.
    expect(options.html).toContain('chart-pages');
  });

  it('is named exactly as the website names the same chart', () => {
    expect(chartPdfName(doc)).toBe(chartPdfFilename('Amazing Grace [D]'));
    expect(chartPdfName(doc)).toBe('Amazing Grace [D].pdf');
  });

  it('treats closing the print sheet as a choice, not a failure', () => {
    expect(isPrintDismissal(new Error('Printing did not complete'))).toBe(true);
    expect(isPrintDismissal(new Error('PDF could not be rendered'))).toBe(false);
    expect(isPrintDismissal('nope')).toBe(false);
  });

  it('keeps the file private and temporary, and never uploads or logs it', () => {
    const io = source('src/lib/chart-pdf.ts');
    expect(io).toContain('printToFileAsync(chartPdfPrintOptions(doc))');
    expect(io.match(/finally \{\n\s+clearChartPdfs\(\);/g)?.length).toBe(2);
    expect(io).not.toMatch(/api\.|fetch\(|console\.|AsyncStorage/);
  });
});

describe('screens use the shared contract only', () => {
  it('saves the chart through updateArrangement with the opened revision, never the song', () => {
    const screen = source('app/song/chart.tsx');
    expect(screen).toContain('api.updateArrangement(arrangement.id, chartArrangementSaveBody(form, baseRevision, defaultName))');
    expect(screen).not.toContain('api.updateSong');
    expect(screen).toContain('isCurrentGeneration(generation)');
    expect(screen).toContain('rebaseDraft(form, baseForm, latestForm)');
    expect(screen).toContain('useDiscardGuard');
    // Preview and PDF are one document.
    expect(screen).toContain('parseChordPro(doc.chordpro)');
    expect(screen).toContain('<ChartPdfActions doc={hasChart ? doc : null} unsaved={dirty} />');
  });

  it('exports the song screen’s chart from the very render shown', () => {
    const screen = source('app/song/[id].tsx');
    expect(screen).toContain('chartDocumentFromContext({ song, context, rendered, locale })');
    expect(screen).not.toMatch(/renderChordProChart|transposeChordPro/);
  });
});
