import type { SupportedLocale } from '../i18n/locales.js';
import { updateArrangementSchema, updateSongSchema, type UpdateArrangementInput, type UpdateSongInput } from '../schemas/song.js';
import type { ArrangementRow } from '../types/database.js';
import type { SongWithArrangements } from '../types/domain.js';
import { chartFormattingFromRow, type ChartDocument, type ChartFormatting } from './chart-html.js';
import type { ChartArrangement, ChartContextReady, ContextChartRender } from './chart-context.js';
import { renderChordProChart, toChordPro, type ChartNotation } from './chordpro.js';

/**
 * The Lyrics & Chords editor's rules, shared by the website's chart editor and
 * the app's (F11/F15, MOB-029): the form it opens with, the request bodies a
 * save becomes, and the `ChartDocument` the preview and the PDF are both made
 * from. The chart is transposed once, here, and every consumer prints the
 * document's already-rendered ChordPro, so no output can transpose it again.
 */

/** How a chart is being read: a key to transpose into, or a key-independent notation. */
export interface ChartViewSelection {
  /** Null means the arrangement's own key. */
  targetKey: string | null;
  notation: ChartNotation;
}

export const ORIGINAL_CHART_VIEW: ChartViewSelection = { targetKey: null, notation: 'chords' };

/**
 * Everything the chart editor holds while it is being edited. The chart itself
 * stays exactly as the person typed it — pasted charts are only normalised into
 * ChordPro on the way to the preview and to the API, never under the cursor.
 */
export interface ChartEditorFormValues {
  /** The song's title. Editing it here edits the song, not the arrangement. */
  title: string;
  arrangementName: string;
  /** The key the chart is written in. */
  songKey: string | null;
  sequence: string[];
  source: string;
  formatting: ChartFormatting;
}

export const chartEditorFormFrom = (
  song: Pick<SongWithArrangements, 'title' | 'default_key'>,
  arrangement: ArrangementRow,
): ChartEditorFormValues => ({
  title: song.title,
  arrangementName: arrangement.name,
  songKey: arrangement.song_key ?? song.default_key,
  sequence: [...arrangement.sequence],
  source: arrangement.chord_chart ?? '',
  formatting: chartFormattingFromRow(arrangement),
});

/**
 * The arrangement half of a save: its name, key, sequence, chart and layout.
 * `defaultName` is the localized name a blank arrangement name falls back to;
 * `expectedRevision` is the arrangement revision the editor opened, so a save
 * over someone else's newer edit is refused (409 `arrangement_revision_stale`).
 */
export const toChartArrangementInput = (
  values: ChartEditorFormValues,
  defaultName: string,
  expectedRevision?: number,
): UpdateArrangementInput => ({
  name: values.arrangementName.trim() || defaultName,
  song_key: values.songKey,
  sequence: values.sequence,
  chord_chart: toChordPro(values.source),
  chord_chart_format: 'chordpro',
  chart_columns: values.formatting.columns,
  chart_font: values.formatting.fontFamily,
  chart_font_size: values.formatting.fontSize,
  chart_chord_color: values.formatting.chordColor,
  ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
});

/** The song half of a save. Only the title is editable from the chart editor. */
export const toChartSongInput = (values: ChartEditorFormValues, expectedRevision?: number): UpdateSongInput => ({
  title: values.title.trim(),
  ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
});

/** True when saving would change either record — what the Save button gates on. */
export const chartEditorIsDirty = (values: ChartEditorFormValues, saved: ChartEditorFormValues): boolean =>
  JSON.stringify(values) !== JSON.stringify(saved);

/** True when the title is unchanged, so a save only writes the arrangement. */
export const chartEditorTitleChanged = (values: ChartEditorFormValues, saved: ChartEditorFormValues): boolean =>
  values.title.trim() !== '' && values.title.trim() !== saved.title;

/** Why a chart editor save cannot be sent as it stands. */
export type ChartEditorProblem = 'title_missing' | 'invalid';

/**
 * Checks the save against the API's own schemas before anything is sent: a
 * blank title, a chart over 100 000 characters, a sequence label over 20
 * characters or more than 60 sections are refused here exactly as the server
 * would refuse them.
 */
export const chartEditorProblem = (values: ChartEditorFormValues, defaultName: string): ChartEditorProblem | null => {
  if (!values.title.trim()) return 'title_missing';
  if (!updateArrangementSchema.safeParse(toChartArrangementInput(values, defaultName)).success) return 'invalid';
  if (!updateSongSchema.safeParse(toChartSongInput(values)).success) return 'invalid';
  return null;
};

export interface ChartDocumentSource {
  values: ChartEditorFormValues;
  song: Pick<SongWithArrangements, 'author' | 'copyright'>;
  /** The key and notation the preview is being read in. */
  view: ChartViewSelection;
  /** Localized title shown when the song title is blank. */
  untitledTitle: string;
  /** Display language of the byline and page. */
  locale: SupportedLocale;
}

/**
 * Turns the form into the document the shared template prints.
 *
 * The chart goes through the same renderer the rest of the app uses, so the
 * key shown in the heading is the key the chords below it are actually in —
 * including when the preview is transposed or read as numbers.
 */
export const chartDocumentFrom = ({ values, song, view, untitledTitle, locale }: ChartDocumentSource): ChartDocument => {
  const rendered = renderChordProChart(toChordPro(values.source), {
    sourceKey: values.songKey,
    targetKey: view.targetKey,
    notation: view.notation,
  });

  return {
    title: values.title.trim() || untitledTitle,
    key: rendered.key,
    arrangementName: values.arrangementName.trim() || null,
    author: song.author,
    sequence: values.sequence,
    copyright: song.copyright,
    chordpro: rendered.chordpro,
    formatting: values.formatting,
    locale,
  };
};

/** The song fields a chart document prints above and below the chart. */
export type ChartDocumentSong = Pick<SongWithArrangements, 'title' | 'author' | 'copyright'>;

/** An arrangement as a chart document reads it: its name and stored layout. */
export type ChartDocumentArrangement = ChartArrangement &
  Pick<ArrangementRow, 'name' | 'chart_columns' | 'chart_font' | 'chart_font_size' | 'chart_chord_color'>;

export interface ChartContextDocumentSource<A extends ChartDocumentArrangement> {
  song: ChartDocumentSong;
  /** The resolved chart context (plan item or library) being shown. */
  context: ChartContextReady<A>;
  /** `renderChartContext(context, …)` — the very chart on screen. */
  rendered: ContextChartRender;
  locale: SupportedLocale;
}

/**
 * The document for a chart as it is being read — the plan item's arrangement,
 * service key and sequence, plus the reader's own shift and notation — built
 * from the render already on screen rather than rendered again. Null when that
 * render produced no chart, so nothing can be exported that was not shown.
 * The fields follow the service song book's, so a phone PDF and the printed
 * book agree for the same plan item.
 */
export const chartDocumentFromContext = <A extends ChartDocumentArrangement>({
  song,
  context,
  rendered,
  locale,
}: ChartContextDocumentSource<A>): ChartDocument | null => {
  if (rendered.status !== 'ready') return null;
  const { arrangement } = context;
  return {
    title: song.title,
    // Numbers, numerals and lyrics carry no key, and say so by leaving it off.
    key: rendered.notation === 'chords' ? (rendered.key ?? context.displayKey) : null,
    arrangementName: arrangement?.name ?? null,
    author: song.author,
    sequence: context.sequence,
    copyright: song.copyright,
    chordpro: rendered.chordpro,
    formatting: chartFormattingFromRow(arrangement ?? {}),
    locale,
  };
};

/** Characters no filesystem wants in a name, control characters included. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]|[\p{Cc}]/gu;
const MAX_FILENAME_LENGTH = 120;

/**
 * Turns a chart's heading into something every filesystem will accept —
 * `Nothing Is Impossible [C].pdf` — so a folder of charts reads as a set list.
 */
export const chartPdfFilename = (title: string): string => {
  const safe = title
    .replace(UNSAFE_FILENAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    // A leading dot hides the file; a trailing one confuses Windows.
    .replace(/^\.+|\.+$/g, '')
    .trim();

  return `${safe || 'chord-chart'}.pdf`;
};
