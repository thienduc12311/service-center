import type { ArrangementRow } from '@service-center/shared';

/**
 * What the song workspace is showing: the overview of every arrangement, or
 * one of them. The sidebar sets it; the main pane and the Schedule panel read
 * it, so the schedule can narrow to the arrangement actually being looked at.
 */
export type SongPane = { kind: 'all' } | { kind: 'arrangement'; arrangementId: string };

export const ALL_ARRANGEMENTS: SongPane = { kind: 'all' };

// MOB-028: the form/request rules moved to `@service-center/shared`
// (`song-authoring`) so the app sends exactly what the website sends.
export {
  DEFAULT_ARRANGEMENT_NAME_KEY,
  NEW_ARRANGEMENT_NAME_KEY,
  SONG_VOCABULARY_LABEL_KEYS,
  arrangementFormFrom,
  newArrangementForm,
  songInformationFormFrom,
  toCreateArrangementInput,
  toUpdateArrangementInput,
  toUpdateSongInput,
  type ArrangementFormValues,
  type SongInformationFormValues,
} from '@service-center/shared';

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
