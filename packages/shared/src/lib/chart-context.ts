/**
 * Which arrangement, key and sequence a chart should be read in.
 *
 * A chart opened from a plan belongs to that plan item: its arrangement, its
 * service key and its sequence — never the song's default, which may be a
 * different version in a different key. A chart opened from the library
 * starts at the song's default arrangement and lets the reader pick another.
 * Either way, picking here is a viewing choice; nothing is saved.
 */

import type { ArrangementRow, PlanItemRow } from '../types/database.js';
import type { SongWithArrangements } from '../types/domain.js';
import {
  parseKey,
  renderChordProChart,
  transposeKey,
  type ChartNotation,
  type RenderedChart,
} from './chordpro.js';

/** The plan item fields a chart context reads; the rest of the row is irrelevant. */
export type ChartContextPlanItem = Pick<
  PlanItemRow,
  'id' | 'item_type' | 'song_id' | 'arrangement_id' | 'key_override'
>;

export interface ChartContextInput {
  song: SongWithArrangements;
  /** The plan item the chart was opened from; null or absent in the library. */
  planItem?: ChartContextPlanItem | null;
  /**
   * An arrangement the reader picked on this screen. In the library it is the
   * selection; in plan context it is a temporary view that is never saved.
   * Ignored when it is not one of this song's arrangements.
   */
  viewArrangementId?: string | null;
}

/** Why a chart context cannot be shown, rather than substituting another version. */
export type ChartContextUnavailableReason =
  /** The plan item is a header or free-form item, or names no song. */
  | 'not_a_song'
  /** The plan item names a different song from the one being opened. */
  | 'song_mismatch'
  /** The plan item names an arrangement that is not (or no longer) this song's. */
  | 'arrangement_missing';

export interface ChartContextUnavailable {
  status: 'unavailable';
  reason: ChartContextUnavailableReason;
}

export interface ChartContextReady {
  status: 'ready';
  source: 'plan' | 'library';
  /** What is being shown; null only when the song has no arrangements at all. */
  arrangement: ArrangementRow | null;
  /** The arrangement the plan item is set to, in plan context. */
  planArrangement: ArrangementRow | null;
  /** True when the reader is viewing an arrangement other than the plan's. */
  isTemporaryView: boolean;
  /** The key the chart is written in: the arrangement's, else the song's. */
  sourceKey: string | null;
  /** The key to read it in: the plan item's override, else the source key. */
  displayKey: string | null;
  /** True when `displayKey` came from the plan item's key override. */
  keyFromPlan: boolean;
  /** Section order to play; empty when none is set. */
  sequence: readonly string[];
}

export type ChartContext = ChartContextReady | ChartContextUnavailable;

const defaultArrangement = (song: SongWithArrangements): ArrangementRow | null =>
  song.arrangements.find((candidate) => candidate.is_default) ?? song.arrangements[0] ?? null;

const findArrangement = (
  song: SongWithArrangements,
  id: string | null | undefined,
): ArrangementRow | null =>
  id ? (song.arrangements.find((candidate) => candidate.id === id) ?? null) : null;

const blankToNull = (value: string | null | undefined): string | null =>
  value && value.trim() ? value.trim() : null;

/**
 * Resolves the chart to show. An item's explicitly chosen arrangement is
 * looked up among the song's own arrangements, so an id that belongs to a
 * different song (or has been deleted) shows as unavailable instead of
 * falling back to a version the plan did not choose.
 */
export const resolveChartContext = ({
  song,
  planItem = null,
  viewArrangementId = null,
}: ChartContextInput): ChartContext => {
  const viewed = findArrangement(song, viewArrangementId);

  if (!planItem) {
    const arrangement = viewed ?? defaultArrangement(song);
    const sourceKey = blankToNull(arrangement?.song_key) ?? blankToNull(song.default_key);
    return {
      status: 'ready',
      source: 'library',
      arrangement,
      planArrangement: null,
      isTemporaryView: false,
      sourceKey,
      displayKey: sourceKey,
      keyFromPlan: false,
      sequence: arrangement?.sequence ?? [],
    };
  }

  if (planItem.item_type !== 'song' || !planItem.song_id) {
    return { status: 'unavailable', reason: 'not_a_song' };
  }
  if (planItem.song_id !== song.id) return { status: 'unavailable', reason: 'song_mismatch' };

  let planArrangement: ArrangementRow | null;
  if (planItem.arrangement_id) {
    planArrangement = findArrangement(song, planItem.arrangement_id);
    if (!planArrangement) return { status: 'unavailable', reason: 'arrangement_missing' };
  } else {
    // The item never chose a version, so it plays the song's default.
    planArrangement = defaultArrangement(song);
  }

  const arrangement = viewed ?? planArrangement;
  const isTemporaryView = Boolean(viewed && viewed.id !== planArrangement?.id);
  const sourceKey = blankToNull(arrangement?.song_key) ?? blankToNull(song.default_key);
  const override = blankToNull(planItem.key_override);

  return {
    status: 'ready',
    source: 'plan',
    arrangement,
    planArrangement,
    isTemporaryView,
    sourceKey,
    displayKey: override ?? sourceKey,
    keyFromPlan: Boolean(override),
    sequence: arrangement?.sequence ?? [],
  };
};

export interface ChartContextRenderOptions {
  /** The reader's own transposition on top of the display key. */
  semitones?: number;
  notation?: ChartNotation;
}

/** Why a ready context still cannot produce a chart. */
export type ChartRenderUnavailableReason =
  /** The arrangement has no chord chart. */
  | 'no_chart'
  /**
   * A key change or key-relative notation was asked for, but the source or
   * target key is missing or unreadable, so chords would be wrong.
   */
  | 'key_unknown';

export type ContextChartRender =
  | ({ status: 'ready' } & RenderedChart)
  | { status: 'unavailable'; reason: ChartRenderUnavailableReason };

const readable = (key: string | null): key is string => Boolean(key && parseKey(key));

/**
 * True when the chart can be moved off its written key: both the key it is
 * written in and the key it should be read in are known and readable.
 */
export const canTransposeChartContext = (context: ChartContextReady): boolean =>
  readable(context.sourceKey) && readable(context.displayKey);

/**
 * Renders the context's chart in its display key plus the reader's shift.
 * The target key is computed once and handed to the shared renderer, so the
 * chords and the key label below are the same result.
 */
export const renderChartContext = (
  context: ChartContextReady,
  { semitones = 0, notation = 'chords' }: ChartContextRenderOptions = {},
): ContextChartRender => {
  const source = context.arrangement?.chord_chart ?? '';
  if (!source.trim()) return { status: 'unavailable', reason: 'no_chart' };

  // Lyrics carry no key, and numbers/numerals are read off the written key
  // alone, so neither depends on the display key.
  if (notation === 'lyrics') return { status: 'ready', ...renderChordProChart(source, { notation }) };
  if (notation !== 'chords') {
    if (!readable(context.sourceKey)) return { status: 'unavailable', reason: 'key_unknown' };
    return {
      status: 'ready',
      ...renderChordProChart(source, { sourceKey: context.sourceKey, notation }),
    };
  }

  const { sourceKey, displayKey } = context;
  if (!readable(sourceKey) || !readable(displayKey)) {
    // Chords are fine as written when nothing asks to move them; anything else
    // would put a key label over the wrong chords.
    const movesKey = semitones !== 0 || displayKey !== sourceKey;
    if (movesKey) return { status: 'unavailable', reason: 'key_unknown' };
    return { status: 'ready', ...renderChordProChart(source, { notation }) };
  }

  const targetKey =
    semitones === 0 ? displayKey : transposeKey(displayKey, semitones, semitones < 0 ? 'flats' : 'sharps');
  return { status: 'ready', ...renderChordProChart(source, { sourceKey, targetKey, notation }) };
};
