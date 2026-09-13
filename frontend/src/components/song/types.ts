import {
  formatDuration,
  parseDuration,
  type ArrangementRow,
  type CreateArrangementInput,
  type SongWithArrangements,
  type UpdateArrangementInput,
  type UpdateSongInput,
} from '@service-center/shared';

/**
 * What the song workspace is showing: the overview of every arrangement, or
 * one of them. The sidebar sets it; the main pane and the Schedule panel read
 * it, so the schedule can narrow to the arrangement actually being looked at.
 */
export type SongPane = { kind: 'all' } | { kind: 'arrangement'; arrangementId: string };

export const ALL_ARRANGEMENTS: SongPane = { kind: 'all' };

export const DEFAULT_ARRANGEMENT_NAME = 'New Arrangement';

/** Trims a text field down to what the API stores: a value, or nothing. */
const textOrNull = (value: string): string | null => value.trim() || null;

// ------------------------------------------------------ song information ---

/** The Song Information dialog, before it is turned into a request body. */
export interface SongInformationFormValues {
  title: string;
  ccliNumber: string;
  authors: string;
  copyright: string;
  administration: string;
  notes: string;
  themes: string[];
}

export const songInformationFormFrom = (
  song: SongWithArrangements,
): SongInformationFormValues => ({
  title: song.title,
  ccliNumber: song.ccli_number ?? '',
  authors: song.author ?? '',
  copyright: song.copyright ?? '',
  administration: song.administration ?? '',
  notes: song.notes ?? '',
  themes: song.themes,
});

export const toUpdateSongInput = (values: SongInformationFormValues): UpdateSongInput => ({
  title: values.title.trim(),
  author: textOrNull(values.authors),
  ccli_number: textOrNull(values.ccliNumber),
  copyright: textOrNull(values.copyright),
  administration: textOrNull(values.administration),
  notes: textOrNull(values.notes),
  themes: values.themes,
});

// ---------------------------------------------------------- arrangements ---

/** The Arrangement dialog. Numbers stay strings while they are being typed. */
export interface ArrangementFormValues {
  name: string;
  songKey: string | null;
  capo: number | null;
  bpm: string;
  meter: string;
  /** "6:35" or plain seconds — both are accepted. */
  length: string;
  /** Comma- or newline-separated sections, e.g. "Intro, V1, C1". */
  sequence: string;
  isDefault: boolean;
}

export const arrangementFormFrom = (arrangement: ArrangementRow): ArrangementFormValues => ({
  name: arrangement.name,
  songKey: arrangement.song_key,
  capo: arrangement.capo,
  bpm: arrangement.bpm === null ? '' : String(arrangement.bpm),
  meter: arrangement.meter ?? '',
  length: arrangement.length_seconds === null ? '' : formatDuration(arrangement.length_seconds),
  sequence: arrangement.sequence.join(', '),
  isDefault: arrangement.is_default,
});

/** A new arrangement starts from the song's own key and tempo. */
export const newArrangementForm = (song: SongWithArrangements): ArrangementFormValues => ({
  name: '',
  songKey: song.default_key,
  capo: null,
  bpm: song.default_bpm === null ? '' : String(song.default_bpm),
  meter: song.meter ?? '',
  length: '',
  sequence: '',
  // The first arrangement has to be the default; plan items point at it.
  isDefault: song.arrangements.length === 0,
});

const parseSequence = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((section) => section.trim())
    .filter(Boolean);

const parseBpm = (value: string): number | null => {
  const bpm = Number(value.trim());
  return value.trim() && Number.isFinite(bpm) ? Math.round(bpm) : null;
};

export const toUpdateArrangementInput = (
  values: ArrangementFormValues,
): UpdateArrangementInput => ({
  name: values.name.trim() || DEFAULT_ARRANGEMENT_NAME,
  song_key: values.songKey,
  capo: values.capo,
  bpm: parseBpm(values.bpm),
  meter: textOrNull(values.meter),
  length_seconds: parseDuration(values.length),
  sequence: parseSequence(values.sequence),
});

export const toCreateArrangementInput = (
  values: ArrangementFormValues,
): CreateArrangementInput => ({
  ...toUpdateArrangementInput(values),
  name: values.name.trim() || DEFAULT_ARRANGEMENT_NAME,
  sequence: parseSequence(values.sequence),
  chord_chart_format: 'chordpro',
  is_default: values.isDefault,
});

/**
 * The arrangement the workspace should open on: the one the sidebar selected,
 * else the song's default, else the first one it has.
 */
export const resolveArrangement = (
  arrangements: readonly ArrangementRow[],
  pane: SongPane,
): ArrangementRow | null => {
  if (pane.kind === 'arrangement') {
    const selected = arrangements.find((candidate) => candidate.id === pane.arrangementId);
    if (selected) return selected;
  }
  return arrangements.find((candidate) => candidate.is_default) ?? arrangements[0] ?? null;
};
