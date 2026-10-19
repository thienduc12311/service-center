import {
  localDateAt,
  type MediaRow,
  type MediaSummary,
  type MediaUsage,
  type RehearsalMediaRef,
} from '@service-center/shared';

/** The media columns a plan item embeds. */
export const PLAN_ITEM_MEDIA_COLUMNS = 'id, title, creator, duration_seconds, archived_at, archive_on';

export type PlanItemMediaEmbed = Pick<
  MediaRow,
  'id' | 'title' | 'creator' | 'duration_seconds' | 'archived_at' | 'archive_on'
>;

/** Today's date where the organization is (archive dates are local dates). */
export const organizationToday = (timeZone: string | null | undefined, now: Date = new Date()): string => {
  try {
    return localDateAt(now.toISOString(), timeZone || 'UTC');
  } catch {
    // An invalid stored zone falls back to UTC rather than failing the read.
    return now.toISOString().slice(0, 10);
  }
};

/** Same rule as `private.media_is_archived`: archived now, or its date has arrived. */
export const isMediaArchived = (row: Pick<MediaRow, 'archived_at' | 'archive_on'>, today: string): boolean =>
  row.archived_at !== null || (row.archive_on !== null && row.archive_on <= today);

export const toRehearsalMediaRef = (row: PlanItemMediaEmbed, today: string): RehearsalMediaRef => ({
  id: row.id,
  title: row.title,
  creator: row.creator,
  duration_seconds: row.duration_seconds,
  archived: isMediaArchived(row, today),
});

/** One row of `plan_items` that uses a bundle, with its plan. */
export interface MediaUsageRow {
  id: string;
  media_id: string | null;
  title: string;
  plan: { id: string; title: string; service_date: string } | null;
}

export const toMediaUsage = (rows: readonly MediaUsageRow[]): MediaUsage[] =>
  rows
    .flatMap((row) =>
      row.plan
        ? [{ plan_id: row.plan.id, plan_title: row.plan.title, service_date: row.plan.service_date, item_id: row.id, item_title: row.title }]
        : [],
    )
    .sort((a, b) => b.service_date.localeCompare(a.service_date) || a.plan_title.localeCompare(b.plan_title));

export const toMediaSummary = (row: MediaRow, today: string, usage: readonly MediaUsage[]): MediaSummary => ({
  id: row.id,
  title: row.title,
  creator: row.creator,
  duration_seconds: row.duration_seconds,
  themes: row.themes ?? [],
  tags: row.tags ?? [],
  notes: row.notes,
  thumbnail_file_id: row.thumbnail_file_id,
  archive_on: row.archive_on,
  archived_at: row.archived_at,
  is_archived: isMediaArchived(row, today),
  revision: row.revision,
  created_at: row.created_at,
  updated_at: row.updated_at,
  usage_count: usage.length,
  last_used_on: usage[0]?.service_date ?? null,
});
