import {
  chartFormattingFromRow,
  renderChordProChart,
  toChordPro,
  type ArrangementRow,
  type ChartDocument,
  type ChartFormatting,
  type SongWithArrangements,
  type UpdateArrangementInput,
  type UpdateSongInput,
} from '@service-center/shared';
import type { ChartView } from '../ChartNotationSelect';

/**
 * Everything the chart editor holds while it is being edited. The chart itself
 * stays exactly as the user typed it — pasted charts are only normalised into
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
  song: SongWithArrangements,
  arrangement: ArrangementRow,
): ChartEditorFormValues => ({
  title: song.title,
  arrangementName: arrangement.name,
  songKey: arrangement.song_key ?? song.default_key,
  sequence: [...arrangement.sequence],
  source: arrangement.chord_chart ?? '',
  formatting: chartFormattingFromRow(arrangement),
});

/** The arrangement half of a save: its name, key, sequence, chart and layout. */
export const toChartArrangementInput = (
  values: ChartEditorFormValues,
): UpdateArrangementInput => ({
  name: values.arrangementName.trim() || 'Default Arrangement',
  song_key: values.songKey,
  sequence: values.sequence,
  chord_chart: toChordPro(values.source),
  chord_chart_format: 'chordpro',
  chart_columns: values.formatting.columns,
  chart_font: values.formatting.fontFamily,
  chart_font_size: values.formatting.fontSize,
  chart_chord_color: values.formatting.chordColor,
});

/** The song half of a save. Only the title is editable from the chart editor. */
export const toChartSongInput = (values: ChartEditorFormValues): UpdateSongInput => ({
  title: values.title.trim(),
});

/** True when saving would change either record — what the Save button gates on. */
export const chartEditorIsDirty = (
  values: ChartEditorFormValues,
  saved: ChartEditorFormValues,
): boolean => JSON.stringify(values) !== JSON.stringify(saved);

export interface ChartDocumentSource {
  values: ChartEditorFormValues;
  song: SongWithArrangements;
  /** The key and notation the preview is being read in. */
  view: ChartView;
}

/**
 * Turns the form into the document the shared template prints.
 *
 * The chart goes through the same renderer the rest of the app uses, so the
 * key shown in the heading is the key the chords below it are actually in —
 * including when the preview is transposed or read as numbers.
 */
export const chartDocumentFrom = ({ values, song, view }: ChartDocumentSource): ChartDocument => {
  const rendered = renderChordProChart(toChordPro(values.source), {
    sourceKey: values.songKey,
    targetKey: view.targetKey,
    notation: view.notation,
  });

  return {
    title: values.title.trim() || 'Untitled song',
    key: rendered.key,
    arrangementName: values.arrangementName.trim() || null,
    author: song.author,
    sequence: values.sequence,
    copyright: song.copyright,
    chordpro: rendered.chordpro,
    formatting: values.formatting,
  };
};
