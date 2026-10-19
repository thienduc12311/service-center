import type {
  ArchiveMediaInput,
  CreateMediaInput,
  ListMediaQuery,
  MediaDetail,
  MediaList,
  MediaRow,
  MediaSummary,
  PlanItemSaveResult,
  SetPlanItemMediaInput,
  UpdateMediaInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { unwrap } from '../lib/supabase.js';
import {
  organizationToday,
  toMediaSummary,
  toMediaUsage,
  type MediaUsageRow,
} from '../model/media.model.js';
import { listParentFiles, type FileCaller } from './files.js';

/**
 * F14 Pass B: reusable media bundles. Every read and write goes through RLS
 * (members read; `media.manage` writes); revisions are compared in the
 * UPDATE's WHERE clause, so a stale edit changes nothing.
 */

const USAGE_LIMIT = 100;
const LIST_LIMIT = 200;
const USAGE_SELECT = 'id, media_id, title, plan:plans(id, title, service_date)';

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

const usageFor = async ({ db }: FileCaller, mediaIds: readonly string[], limit: number): Promise<MediaUsageRow[]> => {
  if (!mediaIds.length) return [];
  return ((await unwrap(
    db.from('plan_items').select(USAGE_SELECT).in('media_id', [...mediaIds]).limit(limit),
  )) ?? []) as unknown as MediaUsageRow[];
};

export const listMedia = async (caller: FileCaller, query: ListMediaQuery): Promise<MediaList> => {
  let request = caller.db.from('media').select('*').eq('organization_id', caller.orgId).order('title').limit(LIST_LIMIT);
  if (query.q) request = request.ilike('title', `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const [rows, date, create] = await Promise.all([unwrap(request), today(caller), canManage(caller)]);
  const media = (rows ?? []) as MediaRow[];
  const usage = await usageFor(caller, media.map((row) => row.id), LIST_LIMIT * 20);
  const summaries = media.map((row) => toMediaSummary(row, date, toMediaUsage(usage.filter((u) => u.media_id === row.id))));
  return {
    media: query.include_archived ? summaries : summaries.filter((summary) => !summary.is_archived),
    can_create: create,
  };
};

export const getMedia = async (caller: FileCaller, mediaId: string): Promise<MediaDetail> => {
  const row = await readRow(caller, mediaId);
  const [date, edit, files, usageRows] = await Promise.all([
    today(caller),
    canManage(caller),
    listParentFiles(caller, { owner_kind: 'media', owner_id: mediaId }),
    usageFor(caller, [mediaId], USAGE_LIMIT),
  ]);
  const usage = toMediaUsage(usageRows);
  return {
    ...toMediaSummary(row, date, usage),
    files: files.files,
    usage,
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
