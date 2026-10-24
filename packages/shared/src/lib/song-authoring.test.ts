import { describe, expect, it } from 'vitest';
import type { ArrangementRow } from '../types/database.js';
import type { Paginated, SongListItem, SongWithArrangements } from '../types/domain.js';
import type { LabeledKey } from '../schemas/arrangement-curation.js';
import { songBulkPatchSchema, updateArrangementSchema, updateSongSchema } from '../schemas/song.js';
import { resolveChartContext } from './chart-context.js';
import {
  EMPTY_ADD_SONG_FORM,
  SONG_LIBRARY_PAGE_SIZE,
  arrangementArchiveBlock,
  arrangementFormFrom,
  blankLabeledKey,
  isAddSongFormDirty,
  isArrangementFormDirty,
  isLabeledKeyDraftDirty,
  isNewArrangementFormDirty,
  isSongInformationDirty,
  labeledKeyDraftFrom,
  mergeSongLibraryPages,
  newArrangementForm,
  nextSongLibraryPage,
  parseSongLibraryFilters,
  rebaseDraft,
  songInformationFormFrom,
  songLibraryBpm,
  songLibraryFilterCount,
  songLibraryKeys,
  toArrangementEdit,
  toCreateArrangementInput,
  toCreateSongInput,
  toUpdateSongInput,
} from './song-authoring.js';

const SONG_ID = '00000000-0000-4000-8000-000000000001';

const arrangement = (overrides: Partial<ArrangementRow>): ArrangementRow => ({
  id: 'arr',
  archived_at: null,
  revision: 3,
  song_id: SONG_ID,
  name: 'Band',
  song_key: 'G',
  capo: null,
  bpm: 72,
  meter: '3/4',
  length_seconds: 275,
  sequence: ['V1', 'C'],
  chord_chart: '[G]Amazing [C]grace',
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

const song = (overrides: Partial<SongWithArrangements> = {}): SongWithArrangements => ({
  id: SONG_ID,
  archived_at: null,
  revision: 7,
  organization_id: 'org',
  title: 'Amazing Grace',
  author: 'John Newton',
  ccli_number: '22025',
  copyright: null,
  administration: null,
  default_key: 'G',
  default_bpm: 72,
  meter: '3/4',
  themes: ['Grace'],
  song_types: ['Hymn'],
  style: 'Traditional',
  speed: 'Slow',
  notes: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  arrangements: [arrangement({ id: 'arr-a', is_default: true }), arrangement({ id: 'arr-b', name: 'Acoustic', song_key: 'A' })],
  ...overrides,
});

describe('add song', () => {
  it('sends the song and a default first arrangement, filling a blank key from the pasted chart', () => {
    const input = toCreateSongInput(
      { ...EMPTY_ADD_SONG_FORM, title: '  How Great  ', chordChart: '[D]O Lord my [G]God', types: ['Hymn'] },
      'Default Arrangement',
    );
    expect(input).toMatchObject({
      title: 'How Great',
      default_key: 'D',
      song_types: ['Hymn'],
      style: null,
      arrangement: { name: 'Default Arrangement', song_key: 'D', chord_chart: '[D]O Lord my [G]God' },
    });
  });

  it('is dirty only once something is typed or chosen', () => {
    expect(isAddSongFormDirty(EMPTY_ADD_SONG_FORM)).toBe(false);
    expect(isAddSongFormDirty({ ...EMPTY_ADD_SONG_FORM, title: '   ' })).toBe(false);
    expect(isAddSongFormDirty({ ...EMPTY_ADD_SONG_FORM, capo: 2 })).toBe(true);
  });
});

describe('song information', () => {
  it('round-trips the stored song without a change, including its types', () => {
    const current = song();
    const form = songInformationFormFrom(current);
    expect(isSongInformationDirty(form, current)).toBe(false);
    expect(toUpdateSongInput(form)).toMatchObject({ title: 'Amazing Grace', song_types: ['Hymn'], themes: ['Grace'], notes: null });
  });

  it('treats whitespace-only edits as no change and trims what it sends', () => {
    const current = song();
    const form = { ...songInformationFormFrom(current), title: ' Amazing Grace ', copyright: '   ' };
    expect(isSongInformationDirty(form, current)).toBe(false);
    expect(isSongInformationDirty({ ...form, songTypes: ['Hymn', 'Communion'] }, current)).toBe(true);
  });

  it('rebases a kept draft onto the latest version without undoing the other edit', () => {
    const opened = songInformationFormFrom(song());
    const latest = songInformationFormFrom(song({ copyright: 'Website edit', revision: 8 }));
    const draft = { ...opened, songTypes: ['Hymn', 'Worship'] };
    const rebased = rebaseDraft(draft, opened, latest);
    expect(rebased).toMatchObject({ songTypes: ['Hymn', 'Worship'], copyright: 'Website edit' });
    // Both changed the same field: the person's own value wins, and they see it before saving.
    expect(rebaseDraft({ ...draft, copyright: 'Mine' }, opened, latest).copyright).toBe('Mine');
  });

  it('accepts an expected revision on updates while bulk patches still refuse it', () => {
    expect(updateSongSchema.parse({ ...toUpdateSongInput(songInformationFormFrom(song())), expected_revision: 7 }).expected_revision).toBe(7);
    expect(updateSongSchema.safeParse({ title: 'x', expected_revision: 0 }).success).toBe(false);
    expect(updateSongSchema.parse({ title: 'x' }).expected_revision).toBeUndefined();
    expect(songBulkPatchSchema.safeParse({ notes: 'x', expected_revision: 7 }).success).toBe(false);
  });
});

describe('arrangements', () => {
  it('edits carry the opened revision and only ever promote the default', () => {
    const row = arrangement({ id: 'arr-b' });
    const form = { ...arrangementFormFrom(row), songKey: 'Bb', isDefault: true };
    const body = toArrangementEdit(form, row, 'Band');
    expect(body).toMatchObject({ song_key: 'Bb', is_default: true, expected_revision: 3, length_seconds: 275, sequence: ['V1', 'C'] });
    expect(updateArrangementSchema.parse(body).expected_revision).toBe(3);

    const currentDefault = arrangement({ id: 'arr-a', is_default: true });
    const unchecked = toArrangementEdit({ ...arrangementFormFrom(currentDefault), isDefault: false }, currentDefault, 'Band');
    expect(unchecked).not.toHaveProperty('is_default');
  });

  it('knows when an arrangement form has changed', () => {
    const row = arrangement({});
    expect(isArrangementFormDirty(arrangementFormFrom(row), row)).toBe(false);
    expect(isArrangementFormDirty({ ...arrangementFormFrom(row), length: '4:35' }, row)).toBe(false);
    expect(isArrangementFormDirty({ ...arrangementFormFrom(row), sequence: 'V1, C, B' }, row)).toBe(true);
    expect(isArrangementFormDirty({ ...arrangementFormFrom(row), isDefault: true }, row)).toBe(true);
  });

  it('starts a new arrangement from the song, as the default only when it is the first', () => {
    expect(newArrangementForm(song()).isDefault).toBe(false);
    const empty = song({ arrangements: [] });
    expect(newArrangementForm(empty)).toMatchObject({ songKey: 'G', bpm: '72', isDefault: true });
    expect(isNewArrangementFormDirty(newArrangementForm(empty), empty)).toBe(false);
    expect(toCreateArrangementInput({ ...newArrangementForm(empty), name: ' ' }, 'New Arrangement')).toMatchObject({
      name: 'New Arrangement',
      is_default: true,
      chord_chart_format: 'chordpro',
    });
  });

  it('mirrors the server archive rule for the last active arrangement', () => {
    const lone = song({ arrangements: [arrangement({ id: 'a', is_default: true }), arrangement({ id: 'b', archived_at: '2026-02-01T00:00:00Z' })] });
    expect(arrangementArchiveBlock(lone, lone.arrangements[0]!)).toBe('last_active');
    // Restoring is always allowed, and an archived song keeps its arrangements archivable.
    expect(arrangementArchiveBlock(lone, lone.arrangements[1]!)).toBeNull();
    expect(arrangementArchiveBlock({ ...lone, archived_at: '2026-02-01T00:00:00Z' }, lone.arrangements[0]!)).toBeNull();
    expect(arrangementArchiveBlock(song(), song().arrangements[0]!)).toBeNull();
  });

  it('lets plans without their own key inherit an edited arrangement key, and keeps plan keys', () => {
    const edited = song({ arrangements: [arrangement({ id: 'arr-a', is_default: true, song_key: 'A' })] });
    const inherited = resolveChartContext({
      song: edited,
      planItem: { id: 'item-1', item_type: 'song', song_id: SONG_ID, arrangement_id: null, key_override: null },
    });
    const ownKey = resolveChartContext({
      song: edited,
      planItem: { id: 'item-2', item_type: 'song', song_id: SONG_ID, arrangement_id: 'arr-a', key_override: 'G' },
    });
    expect(inherited.status === 'ready' && inherited.displayKey).toBe('A');
    expect(ownKey.status === 'ready' && ownKey.displayKey).toBe('G');
  });
});

describe('labeled keys', () => {
  const saved: LabeledKey = {
    id: '00000000-0000-4000-8000-0000000000c1',
    arrangement_id: '00000000-0000-4000-8000-0000000000b1',
    label: 'High',
    song_key: 'E',
    capo: 2,
    vocal_label: null,
    file_ids: ['f2', 'f1'],
    revision: 4,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('opens a saved key at its revision and a new key with a fixed id', () => {
    expect(labeledKeyDraftFrom(saved)).toMatchObject({ id: saved.id, expected_revision: 4, song_key: 'E' });
    expect(blankLabeledKey('k-1')).toMatchObject({ id: 'k-1', expected_revision: null, file_ids: [] });
  });

  it('ignores file order and blank vocal labels when deciding whether a key changed', () => {
    const draft = { ...labeledKeyDraftFrom(saved), file_ids: ['f1', 'f2'], vocal_label: '  ' };
    expect(isLabeledKeyDraftDirty(draft, saved)).toBe(false);
    expect(isLabeledKeyDraftDirty({ ...draft, capo: null }, saved)).toBe(true);
    expect(isLabeledKeyDraftDirty(blankLabeledKey('k-1'), null)).toBe(false);
  });
});

describe('library filters and paging', () => {
  it('reads typed filters exactly as the server validates them', () => {
    const parsed = parseSongLibraryFilters({
      key: 'G',
      theme: ' ',
      bpm_min: '60',
      bpm_max: '120',
      scheduled_from: '2026-01-01',
      scheduled_to: '2026-02-01',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query).toMatchObject({
      key: 'G',
      bpm_min: 60,
      bpm_max: 120,
      scheduled_from: '2026-01-01T00:00:00Z',
      scheduled_to: '2026-02-01T00:00:00Z',
      archive: 'active',
      page: 1,
    });
    expect(parsed.query).not.toHaveProperty('theme');
    expect(songLibraryFilterCount(parsed.query)).toBe(5);
  });

  it('refuses inverted ranges and malformed dates', () => {
    expect(parseSongLibraryFilters({ bpm_min: '130', bpm_max: '90' }).ok).toBe(false);
    expect(parseSongLibraryFilters({ scheduled_from: '2026-02-01', scheduled_to: '2026-01-01' }).ok).toBe(false);
    expect(parseSongLibraryFilters({ scheduled_from: '1/2/2026' }).ok).toBe(false);
  });

  const row = (id: string): SongListItem => ({ ...song({ id, title: id }), last_scheduled_at: null });
  const page = (number: number, ids: string[], total: number): Paginated<SongListItem> => ({
    data: ids.map(row),
    page: number,
    per_page: SONG_LIBRARY_PAGE_SIZE,
    total,
  });

  it('pages beyond 100 songs and stops after the last row', () => {
    const ids = Array.from({ length: 137 }, (_, index) => `song-${String(index).padStart(3, '0')}`);
    const pages: Paginated<SongListItem>[] = [];
    let next: number | undefined = 1;
    while (next !== undefined) {
      const start = (next - 1) * SONG_LIBRARY_PAGE_SIZE;
      const current = page(next, ids.slice(start, start + SONG_LIBRARY_PAGE_SIZE), ids.length);
      pages.push(current);
      next = nextSongLibraryPage(current);
    }
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    const rows = mergeSongLibraryPages(pages);
    expect(rows).toHaveLength(137);
    expect(rows.at(-1)?.id).toBe('song-136');
  });

  it('lists a song that slid onto the next page only once', () => {
    const rows = mergeSongLibraryPages([page(1, ['a', 'b'], 4), page(2, ['b', 'c', 'd'], 4)]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows the keys a song is played in and its tempo', () => {
    expect(songLibraryKeys(song())).toBe('G, A');
    expect(songLibraryKeys(song({ arrangements: [] }))).toBe('G');
    expect(songLibraryBpm(song({ default_bpm: null }))).toBe(72);
  });
});
