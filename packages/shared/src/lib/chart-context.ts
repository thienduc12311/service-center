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
import type { PlanItemArrangement, PlanItemDetail, SongWithArrangements } from '../types/domain.js';
import {
  parseKey,
  renderChordProChart,
  transposeKey,
  type ChartNotation,
  type RenderedChart,
} from './chordpro.js';

/**
 * The plan item fields a chart context reads; the rest of the row is
 * irrelevant. `sequence_override` is optional so rows from older API
 * responses still resolve (they inherit the arrangement's sequence).
 */
export type ChartContextPlanItem = Pick<
  PlanItemRow,
  'id' | 'item_type' | 'song_id' | 'arrangement_id' | 'key_override'
> & { sequence_override?: readonly string[] | null };

/** The arrangement fields the resolver and renderer read. */
export type ChartArrangement = Pick<
  ArrangementRow,
  'id' | 'song_key' | 'sequence' | 'chord_chart' | 'is_default'
>;

/** A song and the arrangements the resolver may choose between. */
export interface ChartSong<A extends ChartArrangement = ArrangementRow> {
  id: string;
  default_key: string | null;
  arrangements: readonly A[];
}

export interface ChartContextInput<A extends ChartArrangement = ArrangementRow> {
  song: ChartSong<A> | SongWithArrangements;
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

export interface ChartContextReady<A extends ChartArrangement = ArrangementRow> {
  status: 'ready';
  source: 'plan' | 'library';
  /** What is being shown; null only when the song has no arrangements at all. */
  arrangement: A | null;
  /** The arrangement the plan item is set to, in plan context. */
  planArrangement: A | null;
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
  /**
   * True when `sequence` is this plan item's own order rather than the
   * arrangement's. A temporary view of another arrangement never uses it.
   */
  sequenceFromPlan: boolean;
}

export type ChartContext<A extends ChartArrangement = ArrangementRow> =
  | ChartContextReady<A>
  | ChartContextUnavailable;

const defaultArrangement = <A extends ChartArrangement>(song: ChartSong<A>): A | null =>
  song.arrangements.find((candidate) => candidate.is_default) ?? song.arrangements[0] ?? null;

const findArrangement = <A extends ChartArrangement>(
  song: ChartSong<A>,
  id: string | null | undefined,
): A | null =>
  id ? (song.arrangements.find((candidate) => candidate.id === id) ?? null) : null;

const blankToNull = (value: string | null | undefined): string | null =>
  value && value.trim() ? value.trim() : null;

/**
 * Resolves the chart to show. An item's explicitly chosen arrangement is
 * looked up among the song's own arrangements, so an id that belongs to a
 * different song (or has been deleted) shows as unavailable instead of
 * falling back to a version the plan did not choose.
 */
export function resolveChartContext(input: ChartContextInput<ArrangementRow>): ChartContext<ArrangementRow>;
export function resolveChartContext<A extends ChartArrangement>(input: ChartContextInput<A>): ChartContext<A>;
export function resolveChartContext<A extends ChartArrangement>({
  song: songInput,
  planItem = null,
  viewArrangementId = null,
}: ChartContextInput<A>): ChartContext<A> {
  // SongWithArrangements carries full rows; both shapes satisfy ChartSong<A>.
  const song = songInput as ChartSong<A>;
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
      sequenceFromPlan: false,
    };
  }

  if (planItem.item_type !== 'song' || !planItem.song_id) {
    return { status: 'unavailable', reason: 'not_a_song' };
  }
  if (planItem.song_id !== song.id) return { status: 'unavailable', reason: 'song_mismatch' };

  let planArrangement: A | null;
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
  const sequenceFromPlan = !isTemporaryView && Array.isArray(planItem.sequence_override);

  return {
    status: 'ready',
    source: 'plan',
    arrangement,
    planArrangement,
    isTemporaryView,
    sourceKey,
    displayKey: override ?? sourceKey,
    keyFromPlan: Boolean(override),
    sequence: sequenceFromPlan ? (planItem.sequence_override ?? []) : (arrangement?.sequence ?? []),
    sequenceFromPlan,
  };
}

/**
 * Resolves a plan item from a plan detail response: the arrangement it chose
 * (only if it really is this song's) or, when it chose none, the song's
 * default the API attached. Everything plan-based — order badge, rehearsal,
 * song book, print — goes through this, so they agree.
 */
export const resolvePlanItemChartContext = (
  item: PlanItemDetail,
): ChartContext<PlanItemArrangement> => {
  if (item.item_type !== 'song' || !item.song) return { status: 'unavailable', reason: 'not_a_song' };
  const arrangements: PlanItemArrangement[] = [];
  // A row from before `song_id` was selected is trusted by its id alone.
  const chosen = item.arrangement;
  if (chosen && chosen.id === item.arrangement_id && (chosen.song_id ?? item.song.id) === item.song.id) {
    arrangements.push(chosen);
  }
  if (!item.arrangement_id && item.default_arrangement) {
    arrangements.push({ ...item.default_arrangement, is_default: true });
  }
  return resolveChartContext<PlanItemArrangement>({
    song: { id: item.song.id, default_key: item.song.default_key, arrangements },
    planItem: item,
  });
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
export const canTransposeChartContext = <A extends ChartArrangement>(context: ChartContextReady<A>): boolean =>
  readable(context.sourceKey) && readable(context.displayKey);

/**
 * Renders the context's chart in its display key plus the reader's shift.
 * The target key is computed once and handed to the shared renderer, so the
 * chords and the key label below are the same result.
 */
export const renderChartContext = <A extends ChartArrangement>(
  context: ChartContextReady<A>,
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
