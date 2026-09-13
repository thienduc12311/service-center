import {
  renderChordProChart,
  type ChartQuery,
  type CreateSongInput,
  type SongChart,
  type SongListItem,
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
