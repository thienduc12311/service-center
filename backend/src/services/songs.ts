import {
  renderChordProChart,
  type ChartQuery,
  type CreateSongInput,
  type SongChart,
  type SongListItem,
  type SongScheduleEntry,
  type SongScheduleQuery,
  type SongWithArrangements,
} from '@service-center/shared';
import { raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export const SONG_SELECT = '*, arrangements:arrangements(*)';

/** Who is creating the song, and where it belongs. */
export interface SongOwnership {
  organizationId: string;
  userId: string;
}

/**
 * Creates the song together with its first arrangement.
 *
 * Every song owns at least one arrangement so plan items always have something
 * to point at. The Add Song form fills that arrangement in directly — its
 * name, key, capo and pasted chart all arrive on the same request — and falls
 * back to the song's own key and tempo for whatever it left blank.
 */
export const createSongWithArrangement = async (
  db: Db,
  { arrangement, ...fields }: CreateSongInput,
  { organizationId, userId }: SongOwnership,
): Promise<SongWithArrangements> => {
  const song = await unwrapOne(
    db
      .from('songs')
      .insert({ ...fields, organization_id: organizationId, created_by: userId })
      .select('*')
      .single(),
  );

  const created = await unwrapOne(
    db
      .from('arrangements')
      .insert({
        ...arrangement,
        song_id: song.id,
        name: arrangement?.name?.trim() || 'Default Arrangement',
        song_key: arrangement?.song_key ?? song.default_key,
        bpm: arrangement?.bpm ?? song.default_bpm,
        meter: arrangement?.meter ?? song.meter,
        is_default: true,
      })
      .select('*')
      .single(),
  );

  return { ...song, arrangements: [created] };
};

/** One `plan_items` row, joined to the service date of the plan it sits in. */
interface ScheduledSongRow {
  song_id: string | null;
  plan: { service_date: string } | null;
}

/**
 * Fills in `last_scheduled_at` for a page of songs: the service date of the
 * most recent plan each one appears in.
 *
 * Aggregated per request rather than denormalised onto `songs`, so it cannot
 * drift when a plan is re-dated or deleted. RLS scopes the join to the
 * caller's organization.
 */
export const attachLastScheduled = async (
  db: Db,
  songs: SongWithArrangements[],
): Promise<SongListItem[]> => {
  if (songs.length === 0) return [];

  const rows = (await unwrap(
    raw(db)
      .from('plan_items')
      .select('song_id, plan:plans!inner(service_date)')
      .in(
        'song_id',
        songs.map((song) => song.id),
      ),
  )) as ScheduledSongRow[] | null;

  const latest = new Map<string, string>();
  for (const row of rows ?? []) {
    const date = row.plan?.service_date;
    if (!row.song_id || !date) continue;
    const current = latest.get(row.song_id);
    if (!current || date > current) latest.set(row.song_id, date);
  }

  return songs.map((song) => ({ ...song, last_scheduled_at: latest.get(song.id) ?? null }));
};

/**
 * One plan the song appears in, with the matching `plan_items` rows embedded.
 * `!inner` plus the `song_id` filter narrows `items` to this song only, so the
 * array holds every slot the song fills in that service — usually exactly one.
 */
interface ScheduledPlanRow {
  id: string;
  title: string;
  service_date: string;
  service_type: { name: string } | null;
  items: Array<{
    arrangement_id: string | null;
    key_override: string | null;
    arrangement: { id: string; name: string; song_key: string | null } | null;
  }>;
}

const SONG_SCHEDULE_SELECT =
  'id, title, service_date,' +
  ' service_type:service_types(name),' +
  ' items:plan_items!inner(arrangement_id, key_override, arrangement:arrangements(id, name, song_key))';

const mapScheduledPlanRowToEntry = (row: ScheduledPlanRow): SongScheduleEntry => {
  // A song listed twice in one service is still one line of history, so the
  // first slot is the one that names the arrangement and key.
  const item = row.items[0];

  return {
    plan_id: row.id,
    plan_title: row.title,
    service_date: row.service_date,
    service_type_name: row.service_type?.name ?? null,
    arrangement_id: item?.arrangement?.id ?? item?.arrangement_id ?? null,
    arrangement_name: item?.arrangement?.name ?? null,
    // The plan's own key wins: it is what was actually played that day.
    key: item?.key_override ?? item?.arrangement?.song_key ?? null,
  };
};

/**
 * The services a song was scheduled in, most recent first.
 *
 * Queried from `plans` rather than `plan_items` so the `limit` counts services
 * — "the last 3 times we played it" — and so the ordering runs on the indexed
 * `plans (organization_id, service_date)` rather than on a joined column.
 */
export const loadSongSchedule = async (
  db: Db,
  songId: string,
  organizationId: string,
  { limit, arrangement_id }: SongScheduleQuery,
): Promise<SongScheduleEntry[]> => {
  let query = raw(db)
    .from('plans')
    .select(SONG_SCHEDULE_SELECT)
    .eq('organization_id', organizationId)
    .eq('items.song_id', songId);

  if (arrangement_id) query = query.eq('items.arrangement_id', arrangement_id);

  const rows = (await unwrap(
    query.order('service_date', { ascending: false }).limit(limit),
  )) as ScheduledPlanRow[] | null;

  return (rows ?? []).map(mapScheduledPlanRowToEntry);
};

/**
 * Reads an arrangement's chart back in the requested key and notation.
 *
 * Both clients go through this rather than converting locally, so a chart
 * printed on stage and one shown on a phone are byte-for-byte identical.
 */
export const loadArrangementChart = async (
  db: Db,
  arrangementId: string,
  { to, semitones, notation }: ChartQuery,
): Promise<SongChart> => {
  const arrangement = await unwrap(
    db
      .from('arrangements')
      .select('id, song_key, chord_chart')
      .eq('id', arrangementId)
      .maybeSingle(),
  );
  if (!arrangement) throw HttpError.notFound('Arrangement not found');

  if (!arrangement.chord_chart) {
    return { chordpro: '', key: arrangement.song_key, semitones: 0, notation };
  }

  if (to && !arrangement.song_key) {
    throw HttpError.badRequest('This arrangement has no key, so it cannot be transposed');
  }

  return renderChordProChart(arrangement.chord_chart, {
    sourceKey: arrangement.song_key,
    targetKey: to ?? null,
    semitones: semitones ?? 0,
    notation,
  });
};
