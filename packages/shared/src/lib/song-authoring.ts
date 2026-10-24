import { formatDuration, parseDuration } from './dates.js';
import { detectKey, toChordPro } from './chordpro.js';
import {
  listSongsQuerySchema,
  type CreateArrangementInput,
  type CreateSongInput,
  type ListSongsQuery,
  type UpdateArrangementInput,
  type UpdateSongInput,
} from '../schemas/song.js';
import type { LabeledKey, LabeledKeyInput } from '../schemas/arrangement-curation.js';
import type { ArrangementRow } from '../types/database.js';
import type { Paginated, SongListItem, SongWithArrangements } from '../types/domain.js';
import type { TranslationKey } from '../i18n/types.js';

/**
 * Song library authoring rules shared by the website and the app (F15 /
 * MOB-028): the forms' starting values, the request bodies they become, and
 * the library's filter and paging rules. Both clients send exactly these
 * shapes, so a song edited on one reads back the same on the other.
 */

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

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * After a stale save, carries a kept draft onto the latest saved version: a
 * field the person never touched (still equal to the version the draft
 * started from) takes the latest value, so re-saving cannot quietly undo
 * someone else's edit; a field they changed keeps their value.
 */
export const rebaseDraft = <T extends object>(draft: T, base: T, latest: T): T => {
  const next = { ...draft };
  for (const key of Object.keys(draft) as (keyof T)[]) {
    if (JSON.stringify(draft[key]) === JSON.stringify(base[key])) next[key] = latest[key];
  }
  return next;
};

// ------------------------------------------------------------- add song ---

/** The Add Song form, before it is turned into a request body. */
export interface AddSongFormValues {
  title: string;
  arrangementName: string;
  key: string | null;
  capo: number | null;
  types: string[];
  style: string;
  speed: string;
  themes: string[];
  chordChart: string;
}

export const EMPTY_ADD_SONG_FORM: AddSongFormValues = {
  title: '',
  arrangementName: '',
  key: null,
  capo: null,
  types: [],
  style: '',
  speed: '',
  themes: [],
  chordChart: '',
};

/** Whether anything has been typed or chosen in the Add Song form. */
export const isAddSongFormDirty = (form: AddSongFormValues): boolean =>
  Boolean(form.title.trim() || form.arrangementName.trim() || form.chordChart.trim() || form.style || form.speed)
  || form.key !== null || form.capo !== null || form.types.length > 0 || form.themes.length > 0;

/**
 * Trims the form into the API's shape, dropping everything left blank.
 * `defaultArrangementName` is the localized name a blank arrangement gets.
 */
export const toCreateSongInput = (form: AddSongFormValues, defaultArrangementName: string): CreateSongInput => {
  // A chart pasted as chords-above-lyrics is folded into inline ChordPro, so
  // either shape can be dropped into the box.
  const chart = toChordPro(form.chordChart);
  // A pasted chart usually opens on the tonic, so it can fill a blank key in.
  const key = form.key ?? (chart ? detectKey(chart) : null);

  return {
    title: form.title.trim(),
    default_key: key,
    themes: form.themes,
    song_types: form.types,
    style: form.style || null,
    speed: form.speed || null,
    arrangement: {
      name: form.arrangementName.trim() || defaultArrangementName,
      song_key: key,
      capo: form.capo,
      chord_chart: chart || null,
    },
  };
};

// ------------------------------------------------------ song information ---

/** The Song Information form, before it is turned into a request body. */
export interface SongInformationFormValues {
  title: string;
  defaultKey: string | null;
  ccliNumber: string;
  authors: string;
  copyright: string;
  administration: string;
  notes: string;
  themes: string[];
  songTypes: string[];
}

export const songInformationFormFrom = (song: SongWithArrangements): SongInformationFormValues => ({
  title: song.title,
  defaultKey: song.default_key,
  ccliNumber: song.ccli_number ?? '',
  authors: song.author ?? '',
  copyright: song.copyright ?? '',
  administration: song.administration ?? '',
  notes: song.notes ?? '',
  themes: song.themes,
  songTypes: song.song_types,
});

/**
 * The whole song information as stored. The revision the form was opened
 * with is added by the caller as `expected_revision`, so a save over someone
 * else's newer edit is refused rather than silently overwriting it.
 */
export const toUpdateSongInput = (values: SongInformationFormValues): UpdateSongInput => ({
  title: values.title.trim(),
  default_key: values.defaultKey,
  author: textOrNull(values.authors),
  ccli_number: textOrNull(values.ccliNumber),
  copyright: textOrNull(values.copyright),
  administration: textOrNull(values.administration),
  notes: textOrNull(values.notes),
  themes: values.themes,
  song_types: values.songTypes,
});

/** Whether saving the form would change the song as it was opened. */
export const isSongInformationDirty = (values: SongInformationFormValues, song: SongWithArrangements): boolean => {
  const next = toUpdateSongInput(values);
  const current = toUpdateSongInput(songInformationFormFrom(song));
  return next.title !== current.title
    || next.default_key !== current.default_key
    || next.author !== current.author
    || next.ccli_number !== current.ccli_number
    || next.copyright !== current.copyright
    || next.administration !== current.administration
    || next.notes !== current.notes
    || !sameList(next.themes ?? [], current.themes ?? [])
    || !sameList(next.song_types ?? [], current.song_types ?? []);
};

// ---------------------------------------------------------- arrangements ---

/** The Arrangement form. Numbers stay strings while they are being typed. */
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
export const toUpdateArrangementInput = (values: ArrangementFormValues, defaultName: string): UpdateArrangementInput => ({
  name: values.name.trim() || defaultName,
  song_key: values.songKey,
  capo: values.capo,
  bpm: parseBpm(values.bpm),
  meter: textOrNull(values.meter),
  length_seconds: parseDuration(values.length),
  sequence: parseSequence(values.sequence),
});

export const toCreateArrangementInput = (values: ArrangementFormValues, defaultName: string): CreateArrangementInput => ({
  ...toUpdateArrangementInput(values, defaultName),
  name: values.name.trim() || defaultName,
  sequence: parseSequence(values.sequence),
  chord_chart_format: 'chordpro',
  is_default: values.isDefault,
});

/**
 * The default flag an edit may send: only ever a promotion. Sending `false`
 * for the current default would leave the song with none; the server moves
 * the default away from the previous one in the same write.
 */
export const arrangementDefaultChange = (
  values: ArrangementFormValues,
  arrangement: Pick<ArrangementRow, 'is_default'>,
): Pick<UpdateArrangementInput, 'is_default'> =>
  values.isDefault && !arrangement.is_default ? { is_default: true } : {};

/** The complete edit body for an existing arrangement, revision included. */
export const toArrangementEdit = (
  values: ArrangementFormValues,
  arrangement: Pick<ArrangementRow, 'is_default' | 'revision'>,
  defaultName: string,
): UpdateArrangementInput => ({
  ...toUpdateArrangementInput(values, defaultName),
  ...arrangementDefaultChange(values, arrangement),
  expected_revision: arrangement.revision,
});

/** Whether saving the form would change the arrangement as it was opened. */
export const isArrangementFormDirty = (values: ArrangementFormValues, arrangement: ArrangementRow): boolean => {
  const opened = arrangementFormFrom(arrangement);
  const next = toUpdateArrangementInput(values, opened.name);
  const current = toUpdateArrangementInput(opened, opened.name);
  return next.name !== current.name
    || next.song_key !== current.song_key
    || next.capo !== current.capo
    || next.bpm !== current.bpm
    || next.meter !== current.meter
    || next.length_seconds !== current.length_seconds
    || !sameList(next.sequence ?? [], current.sequence ?? [])
    || (values.isDefault && !arrangement.is_default);
};

/** Whether the new-arrangement form holds anything beyond its starting values. */
export const isNewArrangementFormDirty = (values: ArrangementFormValues, song: SongWithArrangements): boolean => {
  const start = newArrangementForm(song);
  return values.name.trim() !== '' || values.songKey !== start.songKey || values.capo !== start.capo
    || values.bpm.trim() !== start.bpm || values.meter.trim() !== start.meter || values.length.trim() !== ''
    || values.sequence.trim() !== '' || values.isDefault !== start.isDefault;
};

/** The arrangements still offered for new plans: archived ones only keep history. */
export const activeArrangements = <T extends Pick<ArrangementRow, 'archived_at'>>(arrangements: readonly T[]): T[] =>
  arrangements.filter((arrangement) => !arrangement.archived_at);

/** Why an arrangement cannot be archived right now, if it cannot. */
export type ArrangementArchiveBlock =
  /** An active song keeps at least one active arrangement; archive the song first. */
  'last_active';

/**
 * Mirrors the server's archive rule so the action can say why it is not
 * offered: an active song's last active arrangement cannot be archived.
 * Archiving a default hands the default to the earliest remaining active
 * arrangement (server side); restoring never takes the default back.
 */
export const arrangementArchiveBlock = (
  song: Pick<SongWithArrangements, 'archived_at' | 'arrangements'>,
  arrangement: Pick<ArrangementRow, 'id' | 'archived_at'>,
): ArrangementArchiveBlock | null => {
  if (arrangement.archived_at || song.archived_at) return null;
  const others = activeArrangements(song.arrangements).filter((candidate) => candidate.id !== arrangement.id);
  return others.length === 0 ? 'last_active' : null;
};

// ---------------------------------------------------------- labeled keys ---

/** A fresh labeled key: its id is minted once, so a retried first save replays it. */
export const blankLabeledKey = (id: string): LabeledKeyInput => ({
  id,
  expected_revision: null,
  label: '',
  song_key: 'C',
  capo: null,
  vocal_label: null,
  file_ids: [],
});

/** An existing labeled key opened for editing at the revision it was read with. */
export const labeledKeyDraftFrom = (key: LabeledKey): LabeledKeyInput => ({
  id: key.id,
  expected_revision: key.revision,
  label: key.label,
  song_key: key.song_key,
  capo: key.capo,
  vocal_label: key.vocal_label,
  file_ids: [...key.file_ids],
});

/** Whether the labeled-key draft differs from what is saved (or is new and named). */
export const isLabeledKeyDraftDirty = (draft: LabeledKeyInput, saved: LabeledKey | null): boolean => {
  if (!saved) return draft.label.trim() !== '' || draft.capo !== null || Boolean(draft.vocal_label) || draft.file_ids.length > 0;
  return draft.label.trim() !== saved.label
    || draft.capo !== saved.capo
    || (draft.vocal_label?.trim() || null) !== saved.vocal_label
    || !sameList([...draft.file_ids].sort(), [...saved.file_ids].sort());
};

// ---------------------------------------------------------------- library ---

/** Rows per library page, on both clients. */
export const SONG_LIBRARY_PAGE_SIZE = 50;

/** The library filters as typed (every value a string; blank means "any"). */
export interface SongLibraryFilterValues {
  archive?: string;
  key?: string;
  theme?: string;
  song_type?: string;
  style?: string;
  speed?: string;
  author?: string;
  bpm_min?: string;
  bpm_max?: string;
  /** A calendar date, YYYY-MM-DD, read as the start of that UTC day. */
  scheduled_from?: string;
  /** A calendar date, YYYY-MM-DD; the range ends before that UTC day starts. */
  scheduled_to?: string;
}

export type SongLibraryFilterName = keyof SongLibraryFilterValues;

/** The query parameters that are scope, sort or paging rather than a filter. */
const NOT_FILTERS: ReadonlySet<string> = new Set(['archive', 'sort', 'page', 'per_page', 'q']);

/** The outcome of reading typed filters into a library query. */
export type SongLibraryFilterResult =
  | { ok: true; query: ListSongsQuery }
  | { ok: false; error: Error };

/**
 * Turns typed filters into the `listSongs` query exactly as the server
 * validates it: blanks dropped, dates made UTC day starts, numbers coerced,
 * and the BPM/date ranges checked. Paging and sort come back at their
 * defaults; the caller sets them.
 */
export const parseSongLibraryFilters = (values: SongLibraryFilterValues): SongLibraryFilterResult => {
  const input: Record<string, string> = {};
  for (const [name, raw] of Object.entries(values)) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    input[name] = name === 'scheduled_from' || name === 'scheduled_to' ? `${value}T00:00:00Z` : value;
  }
  const parsed = listSongsQuerySchema.safeParse(input);
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false, error: parsed.error };
};

/** How many filters (not scope, sort or paging) a query applies. */
export const songLibraryFilterCount = (query: Partial<ListSongsQuery>): number =>
  Object.entries(query).filter(([name, value]) => !NOT_FILTERS.has(name) && value !== undefined).length;

/** The next page to read after `page`, or undefined once every row is loaded. */
export const nextSongLibraryPage = (page: Pick<Paginated<unknown>, 'page' | 'per_page' | 'total'>): number | undefined =>
  page.page * page.per_page < page.total ? page.page + 1 : undefined;

/**
 * Loaded pages as one list. Offset pages can shift while someone edits the
 * library, so a song that slid onto a later page is listed once, where it
 * first appeared.
 */
export const mergeSongLibraryPages = (pages: readonly Paginated<SongListItem>[]): SongListItem[] => {
  const seen = new Set<string>();
  const rows: SongListItem[] = [];
  for (const page of pages) {
    for (const song of page.data) {
      if (seen.has(song.id)) continue;
      seen.add(song.id);
      rows.push(song);
    }
  }
  return rows;
};

/** The keys a song is actually played in — its arrangements, not just the default. */
export const songLibraryKeys = (song: SongWithArrangements): string => {
  const keys = song.arrangements.map((arrangement) => arrangement.song_key).filter(Boolean);
  const unique = [...new Set(keys.length ? keys : [song.default_key])].filter(Boolean);
  return unique.join(', ');
};

/** The tempo a library row shows: the song's, else the first arrangement that has one. */
export const songLibraryBpm = (song: SongWithArrangements): number | null =>
  song.default_bpm ?? song.arrangements.find((arrangement) => arrangement.bpm)?.bpm ?? null;
