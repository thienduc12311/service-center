import {
  MEDIA_LIST_LIMIT,
  type ArchiveMediaInput,
  type CreateMediaInput,
  type ListMediaQuery,
  type MediaDetail,
  type MediaList,
  type MediaRow,
  type MediaSummary,
  type PlanItemSaveResult,
  type SetPlanItemMediaInput,
  type UpdateMediaInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { raw, unwrap } from '../lib/supabase.js';
import {
  organizationToday,
  parseMediaListResult,
  toMediaSummary,
  toMediaUsage,
  type MediaListResult,
  type MediaListRpcQuery,
  type MediaUsageRow,
} from '../model/media.model.js';
import { listParentFiles, type FileCaller } from './files.js';

/**
 * F14 Pass B: reusable media bundles. Every read and write goes through RLS
 * (members read; `media.manage` writes); revisions are compared in the
 * UPDATE's WHERE clause, so a stale edit changes nothing.
 */

/** Most "used in" rows the detail page lists, newest first (its counts are exact regardless). */
const USAGE_LIMIT = 100;
/** `!inner`: items in plans the caller cannot see are left out (as the summary counts do). */
const USAGE_SELECT = 'id, media_id, title, plan:plans!inner(id, title, service_date)';

const today = async ({ db, orgId }: FileCaller): Promise<string> => {
  const org = await unwrap(db.from('organizations').select('timezone').eq('id', orgId).maybeSingle());
  return organizationToday(org?.timezone);
};

const canManage = async ({ db, orgId }: FileCaller): Promise<boolean> => {
  const { data, error } = await db.rpc('has_capability', { p_org: orgId, p_cap: 'media.manage' });
  if (error) throw fromPostgrestError(error);
  return data === true;
};

const readRow = async ({ db, orgId }: FileCaller, mediaId: string): Promise<MediaRow> => {
  const row = await unwrap(db.from('media').select('*').eq('id', mediaId).eq('organization_id', orgId).maybeSingle());
  if (!row) throw HttpError.notFound('Media not found');
  return row as MediaRow;
};

/** The newest `limit` plan items using one bundle (newest service date first). */
const usageFor = async ({ db }: FileCaller, mediaId: string, limit: number): Promise<MediaUsageRow[]> =>
  ((await unwrap(
    raw(db)
      .from('plan_items')
      .select(USAGE_SELECT)
      .eq('media_id', mediaId)
      .order('plan(service_date)', { ascending: false })
      .order('id')
      .limit(limit),
  )) ?? []) as unknown as MediaUsageRow[];

/**
 * Runs `public.list_media` as the caller: search, the archived filter and the
 * row cap apply in SQL (archived bundles are dropped before the cap), and
 * usage counts are exact.
 */
const listMediaRows = async ({ db, orgId }: FileCaller, query: MediaListRpcQuery): Promise<MediaListResult> => {
  const { data, error } = await db.rpc('list_media', { p_org: orgId, p_query: query });
  if (error) throw fromPostgrestError(error);
  return parseMediaListResult(data);
};

export const listMedia = async (caller: FileCaller, query: ListMediaQuery): Promise<MediaList> => {
  const date = await today(caller);
  const [result, create] = await Promise.all([
    listMediaRows(caller, {
      ...(query.q ? { q: query.q } : {}),
      include_archived: query.include_archived,
      today: date,
      limit: MEDIA_LIST_LIMIT,
    }),
    canManage(caller),
  ]);
  return {
    media: result.media.map((row) => toMediaSummary(row, date, row)),
    can_create: create,
    total: result.total,
    truncated: result.truncated,
  };
};

export const getMedia = async (caller: FileCaller, mediaId: string): Promise<MediaDetail> => {
  const [row, date] = await Promise.all([readRow(caller, mediaId), today(caller)]);
  const [edit, files, usageRows, counted] = await Promise.all([
    canManage(caller),
    listParentFiles(caller, { owner_kind: 'media', owner_id: mediaId }),
    usageFor(caller, mediaId, USAGE_LIMIT),
    listMediaRows(caller, { media_id: mediaId, include_archived: true, today: date, limit: 1 }),
  ]);
  // Counts come from SQL, so they stay exact past the listed USAGE_LIMIT rows.
  const counts = counted.media[0] ?? { usage_count: 0, last_used_on: null };
  return {
    ...toMediaSummary(row, date, counts),
    files: files.files,
    usage: toMediaUsage(usageRows),
    can_edit: edit,
    can_add_files: files.can_add,
  };
};

export const createMedia = async (caller: FileCaller, input: CreateMediaInput): Promise<MediaDetail> => {
  const row = await unwrap(
    caller.db
      .from('media')
      .insert({
        organization_id: caller.orgId,
        title: input.title,
        creator: input.creator ?? null,
        duration_seconds: input.duration_seconds ?? null,
        themes: input.themes ?? [],
        tags: input.tags ?? [],
        notes: input.notes ?? null,
        archive_on: input.archive_on ?? null,
      })
      .select('id')
      .single(),
  );
  return getMedia(caller, (row as { id: string }).id);
};

/** Compare-and-set on `revision`: zero rows means stale (or gone). */
const updateWithRevision = async (
  caller: FileCaller,
  mediaId: string,
  expectedRevision: number,
  patch: Partial<MediaRow>,
): Promise<void> => {
  await readRow(caller, mediaId);
  const rows = await unwrap(
    caller.db.from('media').update(patch).eq('id', mediaId).eq('revision', expectedRevision).select('id'),
  );
  if (!rows?.length) {
    throw new HttpError(409, 'This media changed since you opened it. Reload and try again.', 'media_revision_stale');
  }
};

export const updateMedia = async (caller: FileCaller, mediaId: string, input: UpdateMediaInput): Promise<MediaDetail> => {
  const patch: Partial<MediaRow> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.creator !== undefined) patch.creator = input.creator;
  if (input.duration_seconds !== undefined) patch.duration_seconds = input.duration_seconds;
  if (input.themes !== undefined) patch.themes = input.themes;
  if (input.tags !== undefined) patch.tags = input.tags;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.archive_on !== undefined) patch.archive_on = input.archive_on;
  if (input.thumbnail_file_id !== undefined) patch.thumbnail_file_id = input.thumbnail_file_id;
  await updateWithRevision(caller, mediaId, input.expected_revision, patch);
  return getMedia(caller, mediaId);
};

export const archiveMedia = async (caller: FileCaller, mediaId: string, input: ArchiveMediaInput): Promise<MediaSummary> => {
  await updateWithRevision(caller, mediaId, input.expected_revision, {
    archived_at: input.archived ? new Date().toISOString() : null,
    // Restoring also clears a past archive date, or it would stay hidden.
    ...(input.archived ? {} : { archive_on: null }),
  });
  const detail = await getMedia(caller, mediaId);
  const { files: _files, usage: _usage, can_edit: _edit, can_add_files: _add, ...summary } = detail;
  return summary;
};

/** Refused while any plan item uses it (archive instead); its files go with it. */
export const deleteMedia = async (caller: FileCaller, mediaId: string, expectedRevision: number): Promise<void> => {
  await readRow(caller, mediaId);
  const { data, error } = await caller.db.from('media').delete().eq('id', mediaId).eq('revision', expectedRevision).select('id');
  if (error) {
    if (error.code === '23503') {
      throw new HttpError(409, 'Plans use this media. Archive it instead to keep their history.', 'media_in_use');
    }
    throw fromPostgrestError(error);
  }
  if (!data?.length) {
    throw new HttpError(409, 'This media changed since you opened it. Reload and try again.', 'media_revision_stale');
  }
};

export const setPlanItemMedia = async (
  caller: FileCaller,
  planId: string,
  itemId: string,
  input: SetPlanItemMediaInput,
): Promise<PlanItemSaveResult> => {
  const plan = await unwrap(caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');
  if (input.media_id) await readRow(caller, input.media_id);
  const { data, error } = await caller.db.rpc('set_plan_item_media', {
    p_plan_id: planId,
    p_item_id: itemId,
    p_media_id: input.media_id,
    p_expected_revision: input.expected_revision ?? null,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Item not found');
  return data;
};
