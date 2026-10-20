import {
  formatDuration,
  parseDuration,
  type ArrangementRow,
  type CreateArrangementInput,
  type SongWithArrangements,
  type UpdateArrangementInput,
  type TranslationKey,
  type UpdateSongInput,
} from '@service-center/shared';

/**
 * What the song workspace is showing: the overview of every arrangement, or
 * one of them. The sidebar sets it; the main pane and the Schedule panel read
 * it, so the schedule can narrow to the arrangement actually being looked at.
 */
export type SongPane = { kind: 'all' } | { kind: 'arrangement'; arrangementId: string };

export const ALL_ARRANGEMENTS: SongPane = { kind: 'all' };

/**
 * Catalog keys for the stored default arrangement name. The name is written in
 * the creator's language and is user content from then on.
 */
export const NEW_ARRANGEMENT_NAME_KEY: TranslationKey<'songs'> = 'arrangement.defaultNewName';
export const DEFAULT_ARRANGEMENT_NAME_KEY: TranslationKey<'songs'> = 'arrangement.defaultName';

/**
 * Display keys for the SONG_STYLES / SONG_SPEEDS / SONG_TYPES vocabularies.
 * The stored value stays the English constant; only its caption is
 * translated. Unknown (legacy or free-typed) values are shown as stored.
 */
export const SONG_VOCABULARY_LABEL_KEYS: Readonly<Record<string, TranslationKey<'songs'>>> = {
  Hymn: 'vocabulary.type.hymn',
  Chorus: 'vocabulary.type.chorus',
  Praise: 'vocabulary.type.praise',
  Worship: 'vocabulary.type.worship',
  Communion: 'vocabulary.type.communion',
  Offering: 'vocabulary.type.offering',
  Response: 'vocabulary.type.response',
  Christmas: 'vocabulary.type.christmas',
  Easter: 'vocabulary.type.easter',
  Special: 'vocabulary.type.special',
  Traditional: 'vocabulary.style.traditional',
  Contemporary: 'vocabulary.style.contemporary',
  Gospel: 'vocabulary.style.gospel',
  Modern: 'vocabulary.style.modern',
  Acoustic: 'vocabulary.style.acoustic',
  Classical: 'vocabulary.style.classical',
  Fast: 'vocabulary.speed.fast',
  Medium: 'vocabulary.speed.medium',
  Slow: 'vocabulary.speed.slow',
};

/** Trims a text field down to what the API stores: a value, or nothing. */
const textOrNull = (value: string): string | null => value.trim() || null;

// ------------------------------------------------------ song information ---

/** The Song Information dialog, before it is turned into a request body. */
export interface SongInformationFormValues {
  title: string;
  defaultKey: string | null;
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
  defaultKey: song.default_key,
  ccliNumber: song.ccli_number ?? '',
  authors: song.author ?? '',
  copyright: song.copyright ?? '',
  administration: song.administration ?? '',
  notes: song.notes ?? '',
  themes: song.themes,
});

export const toUpdateSongInput = (values: SongInformationFormValues): UpdateSongInput => ({
  title: values.title.trim(),
  default_key: values.defaultKey,
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

/** `defaultName` is the localized name a blank name falls back to. */
export const toUpdateArrangementInput = (
  values: ArrangementFormValues,
  defaultName: string,
): UpdateArrangementInput => ({
  name: values.name.trim() || defaultName,
  song_key: values.songKey,
  capo: values.capo,
  bpm: parseBpm(values.bpm),
  meter: textOrNull(values.meter),
  length_seconds: parseDuration(values.length),
  sequence: parseSequence(values.sequence),
});

export const toCreateArrangementInput = (
  values: ArrangementFormValues,
  defaultName: string,
): CreateArrangementInput => ({
  ...toUpdateArrangementInput(values, defaultName),
  name: values.name.trim() || defaultName,
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
