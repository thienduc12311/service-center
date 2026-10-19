import type {
  AttachmentAudienceTargetRow,
  AttachmentLinkRow,
  AttachmentRow,
  AttachmentVersionRow,
  CreateFileUploadIntentInput,
  FileFailureReason,
  FileLinkSummary,
  FileOwnerKind,
  FileOwnerRef,
  FileSummary,
  FileVersionSummary,
  PlanFileEntry,
  PlanFileSource,
} from '@service-center/shared';

/** Version columns a client may see (never the document body or the idempotency key). */
export const FILE_VERSION_COLUMNS =
  'id, attachment_id, version_number, status, filename, mime_type, size_bytes, declared_size, failure_reason, upload_expires_at, created_at, created_by, finalized_at';

export type FileVersionListRow = Pick<
  AttachmentVersionRow,
  | 'id'
  | 'attachment_id'
  | 'version_number'
  | 'status'
  | 'filename'
  | 'mime_type'
  | 'size_bytes'
  | 'declared_size'
  | 'failure_reason'
  | 'upload_expires_at'
  | 'created_at'
  | 'created_by'
  | 'finalized_at'
>;

/** What the service gathered for a set of files; every row came through RLS. */
export interface FileRowsBundle {
  files: AttachmentRow[];
  versions: FileVersionListRow[];
  targets: AttachmentAudienceTargetRow[];
  writableIds: ReadonlySet<string>;
}

/** The one owner a file row names. */
export const fileOwnerOf = (row: AttachmentRow): FileOwnerRef => {
  switch (row.owner_kind) {
    case 'plan':
      return { kind: 'plan', id: row.plan_id ?? '' };
    case 'plan_item':
      return { kind: 'plan_item', id: row.plan_item_id ?? '' };
    case 'song':
      return { kind: 'song', id: row.song_id ?? '' };
    case 'arrangement':
      return { kind: 'arrangement', id: row.arrangement_id ?? '' };
    case 'service_type':
      return { kind: 'service_type', id: row.service_type_id ?? '' };
    case 'media':
      return { kind: 'media', id: row.media_id ?? '' };
  }
};

/** The attachments column that holds an owner of this kind. */
export const ownerColumn = (kind: FileOwnerKind): keyof AttachmentRow => {
  switch (kind) {
    case 'plan':
      return 'plan_id';
    case 'plan_item':
      return 'plan_item_id';
    case 'song':
      return 'song_id';
    case 'arrangement':
      return 'arrangement_id';
    case 'service_type':
      return 'service_type_id';
    case 'media':
      return 'media_id';
  }
};

export const toFileVersionSummary = (row: FileVersionListRow, currentVersionId: string | null): FileVersionSummary => ({
  id: row.id,
  version_number: row.version_number,
  status: row.status,
  filename: row.filename,
  mime_type: row.mime_type,
  size_bytes: row.size_bytes,
  declared_size: row.declared_size,
  failure_reason: row.failure_reason,
  upload_expires_at: row.upload_expires_at,
  created_at: row.created_at,
  created_by: row.created_by,
  finalized_at: row.finalized_at,
  is_current: row.id === currentVersionId,
});

/** Unfinished uploads stay visible to writers for a day so they can retry or clean up. */
const RECENT_UPLOAD_MS = 24 * 60 * 60 * 1000;

export const toFileSummary = (row: AttachmentRow, bundle: FileRowsBundle, now: Date = new Date()): FileSummary => {
  const versions = bundle.versions.filter((version) => version.attachment_id === row.id);
  const current = versions.find((version) => version.id === row.current_version_id) ?? null;
  const canEdit = bundle.writableIds.has(row.id);
  const pending = canEdit
    ? versions
        .filter(
          (version) =>
            version.status === 'pending' ||
            ((version.status === 'failed' || version.status === 'expired') &&
              now.getTime() - new Date(version.created_at).getTime() < RECENT_UPLOAD_MS &&
              version.failure_reason !== 'abandoned'),
        )
        .map((version) => toFileVersionSummary(version, row.current_version_id))
    : [];
  return {
    id: row.id,
    owner: fileOwnerOf(row),
    plan_id: row.plan_id,
    song_id: row.song_id,
    kind: row.kind,
    title: row.title,
    category: row.category,
    audience: row.audience,
    audience_targets: bundle.targets
      .filter((target) => target.attachment_id === row.id)
      .map((target) => ({ team_id: target.team_id, position_id: target.position_id })),
    external_url: row.external_url,
    // Rows from before F14 carry no rights column: they were downloadable.
    playback_rights: row.playback_rights ?? 'download',
    current_version: current ? toFileVersionSummary(current, row.current_version_id) : null,
    pending_versions: pending,
    revision: row.revision,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    can_edit: canEdit,
  };
};

export const toFileLinkSummary = (row: AttachmentLinkRow): FileLinkSummary => ({
  id: row.id,
  attachment_id: row.attachment_id,
  plan_id: row.plan_id,
  plan_item_id: row.plan_item_id,
  pinned_version_id: row.pinned_version_id,
  source: row.source,
  created_at: row.created_at,
});

/** The items of one plan as the plan-files view needs them. */
export interface PlanFileItemRow {
  /** F15 effective key selection, already filtered through F13. */
  effective_file_ids?: string[];
  id: string;
  song_id: string | null;
  arrangement_id: string | null;
}

/**
 * Puts every file a plan uses in one list: the plan's own and its items'
 * files, the songs/arrangements of its items, and linked library/default
 * files. A link names the version this plan uses (pinned or current).
 */
export const buildPlanFileEntries = (
  items: PlanFileItemRow[],
  links: AttachmentLinkRow[],
  bundle: FileRowsBundle,
  now: Date = new Date(),
): PlanFileEntry[] => {
  const byId = new Map(bundle.files.map((row) => [row.id, row]));
  const summary = (row: AttachmentRow): FileSummary => toFileSummary(row, bundle, now);
  const entries: PlanFileEntry[] = [];
  const seen = new Set<string>();
  const push = (row: AttachmentRow, source: PlanFileSource, itemId: string | null, link: AttachmentLinkRow | null) => {
    const key = `${row.id}:${itemId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const file = summary(row);
    const pinned = link?.pinned_version_id
      ? bundle.versions.find((version) => version.id === link.pinned_version_id)
      : undefined;
    const version = pinned ? toFileVersionSummary(pinned, row.current_version_id) : file.current_version;
    // A pinned link whose version the caller cannot read shows nothing rather than the current one.
    if (link?.pinned_version_id && !pinned) return;
    if (row.archived_at && !pinned && !file.can_edit) return;
    entries.push({
      file,
      source,
      plan_item_id: itemId,
      link: link ? toFileLinkSummary(link) : null,
      version,
      newer_version_available: Boolean(
        pinned && row.current_version_id && row.current_version_id !== pinned.id && !row.archived_at,
      ),
    });
  };

  for (const row of bundle.files) {
    if (row.owner_kind === 'plan') push(row, 'plan', null, null);
    if (row.owner_kind === 'plan_item') push(row, 'item', row.plan_item_id, null);
  }
  for (const link of links) {
    const row = byId.get(link.attachment_id);
    if (row) push(row, 'link', link.plan_item_id, link);
  }
  // Under each song item: its arrangement's files first (most specific), then the song's.
  const live = bundle.files.filter((row) => !row.archived_at);
  for (const item of items) {
    if (item.effective_file_ids) {
      for (const row of live) {
        if (item.effective_file_ids.includes(row.id)) push(row, row.owner_kind === 'song' ? 'song' : 'arrangement', item.id, null);
      }
      continue;
    }
    for (const row of live) {
      if (item.arrangement_id && row.owner_kind === 'arrangement' && row.arrangement_id === item.arrangement_id) {
        push(row, 'arrangement', item.id, null);
      }
    }
    for (const row of live) {
      if (item.song_id && row.owner_kind === 'song' && row.song_id === item.song_id) push(row, 'song', item.id, null);
    }
  }
  return entries;
};

/** Arguments of `public.create_file_upload_intent`. */
export const uploadIntentRpcArgs = (input: CreateFileUploadIntentInput) => ({
  p_owner_kind: input.owner?.kind ?? 'plan',
  p_owner_id: input.owner?.id ?? input.file_id ?? '',
  p_attachment: input.file_id ?? null,
  p_expected_revision: input.expected_revision ?? null,
  p_filename: input.filename,
  p_mime_type: input.mime_type,
  p_size_bytes: input.size_bytes,
  p_title: input.title ?? null,
  p_category: input.category,
  p_audience: input.audience,
  p_team_ids: input.team_ids,
  p_position_ids: input.position_ids,
  p_idempotency_key: input.idempotency_key,
});

const FAILURE_REASONS: readonly FileFailureReason[] = ['size_mismatch', 'type_mismatch', 'superseded', 'expired', 'abandoned'];

export const toFailureReason = (value: unknown): FileFailureReason | null =>
  typeof value === 'string' && (FAILURE_REASONS as readonly string[]).includes(value)
    ? (value as FileFailureReason)
    : null;
