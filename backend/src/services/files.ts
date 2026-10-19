import {
  FILE_DOWNLOAD_TTL_SECONDS,
  FILE_UPLOAD_TTL_SECONDS,
  type ArchiveFileInput,
  type AttachmentAudienceTargetRow,
  type AttachmentLinkRow,
  type AttachmentRow,
  type CreateFileDocumentInput,
  type CreateFileLinkInput,
  type CreateFileUploadIntentInput,
  type FileDetail,
  type FileDocument,
  type FileDownload,
  type FileDownloadInput,
  type FileFinalizeResult,
  type FileLinkSummary,
  type FileOwnerKind,
  type FileSummary,
  type FileUploadIntent,
  type FileUploadTarget,
  type LinkFileToPlanInput,
  type ListFilesQuery,
  type ParentFiles,
  type PlanFiles,
  type SaveFileDocumentVersionInput,
  type SetFileLinkPinInput,
  type UpdateFileInput,
  type UpdateFileLinkUrlInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { unwrap, type Db } from '../lib/supabase.js';
import {
  FILE_VERSION_COLUMNS,
  buildPlanFileEntries,
  ownerColumn,
  toFailureReason,
  toFileLinkSummary,
  toFileSummary,
  toFileVersionSummary,
  uploadIntentRpcArgs,
  type FileRowsBundle,
  type FileVersionListRow,
  type PlanFileItemRow,
} from '../model/file.model.js';

/** The caller's RLS-bound client and active organization. */
export interface FileCaller {
  db: Db;
  orgId: string;
}

const BUCKET = 'attachments';

/** Runs a file function; a missing result reads as "not found" (the function refused to see it). */
const rpc = async <T>(
  query: PromiseLike<{ data: T | null; error: Parameters<typeof fromPostgrestError>[0] | null }>,
): Promise<T> => {
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  if (data === null) throw HttpError.notFound('File not found');
  return data;
};

/** For functions that return nothing. */
const rpcVoid = async (query: PromiseLike<{ error: Parameters<typeof fromPostgrestError>[0] | null }>): Promise<void> => {
  const { error } = await query;
  if (error) throw fromPostgrestError(error);
};

/** Versions, audience targets and edit rights of these files — all read through RLS. */
const loadBundle = async (db: Db, files: AttachmentRow[]): Promise<FileRowsBundle> => {
  const ids = files.map((row) => row.id);
  if (!ids.length) return { files, versions: [], targets: [], writableIds: new Set() };
  const [versions, targets, writable] = await Promise.all([
    unwrap(db.from('attachment_versions').select(FILE_VERSION_COLUMNS).in('attachment_id', ids).order('created_at')),
    unwrap(db.from('attachment_audience_targets').select('*').in('attachment_id', ids)),
    db.rpc('writable_file_ids', { p_ids: ids }),
  ]);
  if (writable.error) throw fromPostgrestError(writable.error);
  return {
    files,
    versions: (versions ?? []) as FileVersionListRow[],
    targets: (targets ?? []) as AttachmentAudienceTargetRow[],
    writableIds: new Set((writable.data ?? []) as string[]),
  };
};

const readFileRow = async ({ db, orgId }: FileCaller, fileId: string): Promise<AttachmentRow> => {
  const row = await unwrap(
    db.from('attachments').select('*').eq('id', fileId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!row) throw HttpError.notFound('File not found');
  return row as AttachmentRow;
};

export const getFileSummary = async (caller: FileCaller, fileId: string): Promise<FileSummary> => {
  const row = await readFileRow(caller, fileId);
  return toFileSummary(row, await loadBundle(caller.db, [row]));
};

/** The parent must be visible in the active organization before anything is listed or added. */
const assertOwnerInOrganization = async ({ db, orgId }: FileCaller, kind: FileOwnerKind, id: string): Promise<void> => {
  let found: { id: string } | null = null;
  switch (kind) {
    case 'plan':
      found = await unwrap(db.from('plans').select('id').eq('id', id).eq('organization_id', orgId).maybeSingle());
      break;
    case 'plan_item': {
      const item = await unwrap(db.from('plan_items').select('id, plan_id').eq('id', id).maybeSingle());
      if (item) {
        found = await unwrap(db.from('plans').select('id').eq('id', item.plan_id).eq('organization_id', orgId).maybeSingle());
      }
      break;
    }
    case 'song':
      found = await unwrap(db.from('songs').select('id').eq('id', id).eq('organization_id', orgId).maybeSingle());
      break;
    case 'arrangement': {
      const arrangement = await unwrap(db.from('arrangements').select('id, song_id').eq('id', id).maybeSingle());
      if (arrangement) {
        found = await unwrap(
          db.from('songs').select('id').eq('id', arrangement.song_id).eq('organization_id', orgId).maybeSingle(),
        );
      }
      break;
    }
    case 'service_type':
      found = await unwrap(db.from('service_types').select('id').eq('id', id).eq('organization_id', orgId).maybeSingle());
      break;
  }
  if (!found) throw HttpError.notFound('That parent was not found');
};

/** `GET /files?owner_kind&owner_id`: the files this parent owns that the caller may see. */
export const listParentFiles = async (caller: FileCaller, query: ListFilesQuery): Promise<ParentFiles> => {
  await assertOwnerInOrganization(caller, query.owner_kind, query.owner_id);
  const [rows, canAdd] = await Promise.all([
    unwrap(
      caller.db
        .from('attachments')
        .select('*')
        .eq('organization_id', caller.orgId)
        .eq('owner_kind', query.owner_kind)
        .eq(ownerColumn(query.owner_kind), query.owner_id)
        .order('created_at'),
    ),
    caller.db.rpc('can_add_file', { p_owner_kind: query.owner_kind, p_owner_id: query.owner_id }),
  ]);
  if (canAdd.error) throw fromPostgrestError(canAdd.error);
  const files = (rows ?? []) as AttachmentRow[];
  const bundle = await loadBundle(caller.db, files);
  return {
    owner: { kind: query.owner_kind, id: query.owner_id },
    files: files.map((row) => toFileSummary(row, bundle)),
    can_add: canAdd.data === true,
  };
};

/** `GET /plans/:id/files`: everything a plan uses, each with the version this plan uses. */
export const listPlanFiles = async (caller: FileCaller, planId: string): Promise<PlanFiles> => {
  const { db, orgId } = caller;
  const plan = await unwrap(db.from('plans').select('id').eq('id', planId).eq('organization_id', orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');

  const [items, links, own, canEdit] = await Promise.all([
    unwrap(db.from('plan_items').select('id, song_id, arrangement_id').eq('plan_id', planId).order('sort_order')),
    unwrap(db.from('attachment_links').select('*').eq('plan_id', planId).order('created_at')),
    unwrap(db.from('attachments').select('*').eq('organization_id', orgId).eq('plan_id', planId).order('created_at')),
    db.rpc('can_edit_plan', { p_plan: planId }),
  ]);
  if (canEdit.error) throw fromPostgrestError(canEdit.error);
  const itemRows = (items ?? []) as PlanFileItemRow[];
  const linkRows = (links ?? []) as AttachmentLinkRow[];
  const songIds = [...new Set(itemRows.map((item) => item.song_id).filter((id): id is string => Boolean(id)))];
  const arrangementIds = [...new Set(itemRows.map((item) => item.arrangement_id).filter((id): id is string => Boolean(id)))];
  const linkedIds = [...new Set(linkRows.map((link) => link.attachment_id))];

  const [songFiles, arrangementFiles, linked] = await Promise.all([
    songIds.length
      ? unwrap(db.from('attachments').select('*').eq('organization_id', orgId).eq('owner_kind', 'song').in('song_id', songIds))
      : Promise.resolve([]),
    arrangementIds.length
      ? unwrap(
          db.from('attachments').select('*').eq('organization_id', orgId).eq('owner_kind', 'arrangement').in('arrangement_id', arrangementIds),
        )
      : Promise.resolve([]),
    linkedIds.length
      ? unwrap(db.from('attachments').select('*').eq('organization_id', orgId).in('id', linkedIds))
      : Promise.resolve([]),
  ]);
  const unique = new Map<string, AttachmentRow>();
  for (const row of [...(own ?? []), ...(songFiles ?? []), ...(arrangementFiles ?? []), ...(linked ?? [])] as AttachmentRow[]) {
    unique.set(row.id, row);
  }
  const bundle = await loadBundle(db, [...unique.values()]);
  return { plan_id: planId, entries: buildPlanFileEntries(itemRows, linkRows, bundle), can_edit: canEdit.data === true };
};

export const getFileDetail = async (caller: FileCaller, fileId: string): Promise<FileDetail> => {
  const row = await readFileRow(caller, fileId);
  const [bundle, links] = await Promise.all([
    loadBundle(caller.db, [row]),
    unwrap(caller.db.from('attachment_links').select('*').eq('attachment_id', fileId).order('created_at')),
  ]);
  const summary = toFileSummary(row, bundle);
  return {
    ...summary,
    versions: bundle.versions
      .filter((version) => version.status === 'ready')
      .sort((a, b) => (b.version_number ?? 0) - (a.version_number ?? 0))
      .map((version) => toFileVersionSummary(version, row.current_version_id)),
    links: ((links ?? []) as AttachmentLinkRow[]).map(toFileLinkSummary),
  };
};

/**
 * Upload intent: the database checks parent, rights, type and size and
 * creates the pending version; the signed upload URL is then requested with
 * the caller's own token, so Storage only issues it for that exact intent.
 */
export const createUploadIntent = async (
  caller: FileCaller,
  input: CreateFileUploadIntentInput,
): Promise<FileUploadIntent> => {
  if (input.file_id) await readFileRow(caller, input.file_id);
  else if (input.owner) await assertOwnerInOrganization(caller, input.owner.kind, input.owner.id);
  const result = await rpc(caller.db.rpc('create_file_upload_intent', uploadIntentRpcArgs(input)));
  const version = result.version;
  const file = await getFileSummary(caller, result.attachment.id);
  const summary = toFileVersionSummary(version, result.attachment.current_version_id);

  let upload: FileUploadTarget | null = null;
  if (version.status === 'pending' && version.storage_path) {
    const signed = await caller.db.storage.from(BUCKET).createSignedUploadUrl(version.storage_path);
    if (signed.data) {
      upload = {
        bucket: BUCKET,
        path: signed.data.path,
        token: signed.data.token,
        signed_url: signed.data.signedUrl,
        expires_at:
          version.upload_expires_at ?? new Date(Date.now() + FILE_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      };
    } else if (!result.replayed) {
      // A fresh intent must be uploadable; anything else is a configuration problem.
      throw new HttpError(503, 'File storage is unavailable. Try again shortly.', 'storage_unavailable');
    }
    // A replay whose bytes are already stored cannot be signed again: finalize instead.
  }
  return { file, version: summary, upload, replayed: result.replayed };
};

export const finalizeUpload = async (caller: FileCaller, fileId: string, versionId: string): Promise<FileFinalizeResult> => {
  await readFileRow(caller, fileId).catch(() => {
    // A writer can always read their file; anything else is "not found".
    throw HttpError.notFound('Upload not found');
  });
  const result = await rpc(caller.db.rpc('finalize_file_version', { p_version: versionId }));
  if (result.version.attachment_id !== fileId) throw HttpError.notFound('Upload not found');
  return {
    outcome: result.outcome,
    reason: toFailureReason(result.reason ?? result.version.failure_reason),
    replayed: result.replayed,
    file: await getFileSummary(caller, fileId),
    version: toFileVersionSummary(result.version, result.attachment.current_version_id),
  };
};

export const abandonUpload = async (caller: FileCaller, fileId: string, versionId: string): Promise<{ file_removed: boolean }> => {
  await readFileRow(caller, fileId);
  const version = await unwrap(
    caller.db.from('attachment_versions').select('id, attachment_id').eq('id', versionId).maybeSingle(),
  );
  if (!version || version.attachment_id !== fileId) throw HttpError.notFound('Upload not found');
  const result = await rpc(caller.db.rpc('abandon_file_version', { p_version: versionId }));
  return { file_removed: result.attachment_removed };
};

const saveContent = async (
  caller: FileCaller,
  args: {
    owner: { kind: FileOwnerKind; id: string } | null;
    fileId: string | null;
    expectedRevision: number | null;
    kind: 'link' | 'document';
    title: string;
    url: string | null;
    body: string | null;
    category: UpdateFileInput['category'];
    audience: UpdateFileInput['audience'];
    teamIds: string[];
    positionIds: string[];
    idempotencyKey: string | null;
  },
): Promise<FileSummary> => {
  if (args.fileId) await readFileRow(caller, args.fileId);
  else if (args.owner) await assertOwnerInOrganization(caller, args.owner.kind, args.owner.id);
  const result = await rpc(
    caller.db.rpc('save_file_content', {
      p_owner_kind: args.owner?.kind ?? null,
      p_owner_id: args.owner?.id ?? null,
      p_attachment: args.fileId,
      p_expected_revision: args.expectedRevision,
      p_kind: args.kind,
      p_title: args.title,
      p_external_url: args.url,
      p_document_body: args.body,
      p_category: args.category,
      p_audience: args.audience,
      p_team_ids: args.teamIds,
      p_position_ids: args.positionIds,
      p_idempotency_key: args.idempotencyKey,
    }),
  );
  return getFileSummary(caller, result.attachment.id);
};

export const createLinkFile = (caller: FileCaller, input: CreateFileLinkInput): Promise<FileSummary> =>
  saveContent(caller, {
    owner: input.owner,
    fileId: null,
    expectedRevision: null,
    kind: 'link',
    title: input.title,
    url: input.url,
    body: null,
    category: input.category,
    audience: input.audience,
    teamIds: input.team_ids,
    positionIds: input.position_ids,
    idempotencyKey: input.idempotency_key,
  });

export const updateLinkUrl = async (caller: FileCaller, fileId: string, input: UpdateFileLinkUrlInput): Promise<FileSummary> => {
  const row = await readFileRow(caller, fileId);
  // Audience and category stay as they are; only the title and address change.
  return saveContent(caller, {
    owner: null,
    fileId,
    expectedRevision: input.expected_revision,
    kind: 'link',
    title: input.title,
    url: input.url,
    body: null,
    category: row.category,
    audience: row.audience,
    teamIds: [],
    positionIds: [],
    idempotencyKey: null,
  });
};

export const createDocumentFile = (caller: FileCaller, input: CreateFileDocumentInput): Promise<FileSummary> =>
  saveContent(caller, {
    owner: input.owner,
    fileId: null,
    expectedRevision: null,
    kind: 'document',
    title: input.title,
    url: null,
    body: input.body,
    category: input.category,
    audience: input.audience,
    teamIds: input.team_ids,
    positionIds: input.position_ids,
    idempotencyKey: input.idempotency_key,
  });

export const saveDocumentVersion = async (
  caller: FileCaller,
  fileId: string,
  input: SaveFileDocumentVersionInput,
): Promise<FileSummary> => {
  const row = await readFileRow(caller, fileId);
  return saveContent(caller, {
    owner: null,
    fileId,
    expectedRevision: input.expected_revision,
    kind: 'document',
    title: input.title,
    url: null,
    body: input.body,
    category: row.category,
    audience: row.audience,
    teamIds: [],
    positionIds: [],
    idempotencyKey: null,
  });
};

/** A document version's text, if the caller may read that version. */
export const getDocument = async (caller: FileCaller, fileId: string, versionId: string | undefined): Promise<FileDocument> => {
  const row = await readFileRow(caller, fileId);
  if (row.kind !== 'document') throw HttpError.badRequest('This file is not a text document');
  const targetId = versionId ?? row.current_version_id;
  if (!targetId) throw HttpError.notFound('This document has no saved text yet');
  const version = await unwrap(
    caller.db
      .from('attachment_versions')
      .select(`${FILE_VERSION_COLUMNS}, document_body`)
      .eq('id', targetId)
      .eq('attachment_id', fileId)
      .maybeSingle(),
  );
  if (!version || version.status !== 'ready') throw HttpError.notFound('Version not found');
  const { document_body: body, ...listRow } = version as FileVersionListRow & { document_body: string | null };
  return {
    file: await getFileSummary(caller, fileId),
    version: toFileVersionSummary(listRow, row.current_version_id),
    body: body ?? '',
  };
};

export const updateFileMetadata = async (caller: FileCaller, fileId: string, input: UpdateFileInput): Promise<FileSummary> => {
  await readFileRow(caller, fileId);
  if (input.move_to) await assertOwnerInOrganization(caller, input.move_to.kind, input.move_to.id);
  await rpc(
    caller.db.rpc('update_file', {
      p_attachment: fileId,
      p_expected_revision: input.expected_revision,
      p_title: input.title,
      p_category: input.category,
      p_audience: input.audience,
      p_team_ids: input.team_ids,
      p_position_ids: input.position_ids,
      p_move_owner_kind: input.move_to?.kind ?? null,
      p_move_owner_id: input.move_to?.id ?? null,
    }),
  );
  return getFileSummary(caller, fileId);
};

export const setArchived = async (caller: FileCaller, fileId: string, input: ArchiveFileInput): Promise<FileSummary> => {
  await readFileRow(caller, fileId);
  await rpc(
    caller.db.rpc('set_file_archived', {
      p_attachment: fileId,
      p_expected_revision: input.expected_revision,
      p_archived: input.archived,
    }),
  );
  return getFileSummary(caller, fileId);
};

export const removeFile = async (caller: FileCaller, fileId: string, expectedRevision: number): Promise<void> => {
  await readFileRow(caller, fileId);
  await rpcVoid(caller.db.rpc('delete_file', { p_attachment: fileId, p_expected_revision: expectedRevision }));
};

/**
 * A short-lived URL for one readable version. The URL is signed with the
 * caller's token, so Storage applies the same audience policy at issuance;
 * revoked access means no new URL, but an already issued URL works until it
 * expires (FILE_DOWNLOAD_TTL_SECONDS) and copied bytes cannot be recalled.
 */
export const createDownload = async (caller: FileCaller, fileId: string, input: FileDownloadInput): Promise<FileDownload> => {
  const row = await readFileRow(caller, fileId);
  if (row.kind === 'link') {
    if (!row.external_url) throw HttpError.notFound('This link has no address');
    return { kind: 'external', url: row.external_url, expires_at: null, filename: row.title, version: null };
  }
  if (row.kind === 'document') {
    throw HttpError.badRequest('Open a text document with GET /files/:id/document');
  }
  const targetId = input.version_id ?? row.current_version_id;
  if (!targetId) throw HttpError.notFound('This file has no finished upload yet');
  const version = await unwrap(
    caller.db
      .from('attachment_versions')
      .select(`${FILE_VERSION_COLUMNS}, storage_path`)
      .eq('id', targetId)
      .eq('attachment_id', fileId)
      .maybeSingle(),
  );
  if (!version || version.status !== 'ready' || !version.storage_path) throw HttpError.notFound('Version not found');
  const { storage_path: path, ...listRow } = version as FileVersionListRow & { storage_path: string | null };
  const signed = await caller.db.storage
    .from(BUCKET)
    .createSignedUrl(path ?? '', FILE_DOWNLOAD_TTL_SECONDS, input.disposition === 'attachment' ? { download: listRow.filename } : undefined);
  if (signed.error || !signed.data) throw HttpError.notFound('Version not found');
  return {
    kind: 'signed_url',
    url: signed.data.signedUrl,
    expires_at: new Date(Date.now() + FILE_DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
    filename: listRow.filename,
    version: toFileVersionSummary(listRow, row.current_version_id),
  };
};

export const linkToPlan = async (caller: FileCaller, planId: string, input: LinkFileToPlanInput): Promise<FileLinkSummary> => {
  const plan = await unwrap(
    caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  await readFileRow(caller, input.file_id);
  const link = await rpc(
    caller.db.rpc('link_file_to_plan', {
      p_plan: planId,
      p_item: input.plan_item_id,
      p_attachment: input.file_id,
      p_pin: input.pin,
    }),
  );
  return toFileLinkSummary(link);
};

const readLink = async ({ db, orgId }: FileCaller, linkId: string): Promise<AttachmentLinkRow> => {
  const link = await unwrap(
    db.from('attachment_links').select('*').eq('id', linkId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!link) throw HttpError.notFound('Link not found');
  return link as AttachmentLinkRow;
};

export const setLinkPin = async (caller: FileCaller, linkId: string, input: SetFileLinkPinInput): Promise<FileLinkSummary> => {
  await readLink(caller, linkId);
  if (input.mode === 'version' && !input.version_id) throw HttpError.badRequest('Choose the version to pin');
  const link = await rpc(
    caller.db.rpc('set_file_link_pin', {
      p_link: linkId,
      p_version: input.mode === 'version' ? (input.version_id ?? null) : null,
      p_follow: input.mode === 'follow',
    }),
  );
  return toFileLinkSummary(link);
};

export const unlink = async (caller: FileCaller, linkId: string): Promise<void> => {
  await readLink(caller, linkId);
  await rpcVoid(caller.db.rpc('unlink_file', { p_link: linkId }));
};
