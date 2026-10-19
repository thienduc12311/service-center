/**
 * F13: versioned attachments and enforced file audiences.
 *
 * A file (`attachments` row) has exactly one primary owner and immutable
 * versions. Uploads go intent → upload to the exact path → finalize; only a
 * finalized version is ever shown as a file. Plans reuse library and
 * service-type default files through links, optionally pinned to a version.
 * Who may read a file, a version and its bytes is decided by the database
 * (RLS and Storage policies); these types only describe what came back.
 */

/** The single primary parent of a file. */
export type FileOwnerKind = 'plan' | 'plan_item' | 'song' | 'arrangement' | 'service_type';

/**
 * Who may read the file. Leaders (writers plus schedulers at the plan's or
 * service type's scope) always may. `scheduled` counts released, not-declined
 * requests on the owner plan only (plan and item files).
 */
export type FileAudience = 'organization' | 'scheduled' | 'teams' | 'positions' | 'leaders';

/** Uploaded bytes, an external link (never fetched by the server) or a text document. */
export type FileKind = 'upload' | 'link' | 'document';

export type FileCategory = 'chart' | 'lyrics' | 'audio' | 'video' | 'image' | 'document' | 'other';

export type FileVersionStatus = 'pending' | 'ready' | 'failed' | 'expired';

/** Why a pending upload did not become a version. */
export type FileFailureReason = 'size_mismatch' | 'type_mismatch' | 'superseded' | 'expired' | 'abandoned';

export type FileLinkSource = 'manual' | 'service_type_default';

// ------------------------------------------------------------------ rows --

export type AttachmentRow = {
  id: string;
  organization_id: string;
  owner_kind: FileOwnerKind;
  plan_id: string | null;
  plan_item_id: string | null;
  song_id: string | null;
  arrangement_id: string | null;
  service_type_id: string | null;
  kind: FileKind;
  title: string;
  category: FileCategory;
  audience: FileAudience;
  external_url: string | null;
  current_version_id: string | null;
  revision: number;
  /** Legacy mirrors of the current version. */
  storage_path: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export type AttachmentVersionRow = {
  id: string;
  attachment_id: string;
  organization_id: string;
  version_number: number | null;
  status: FileVersionStatus;
  storage_path: string | null;
  filename: string;
  mime_type: string;
  declared_size: number;
  size_bytes: number | null;
  document_body: string | null;
  base_version_id: string | null;
  idempotency_key: string | null;
  upload_expires_at: string | null;
  failure_reason: FileFailureReason | null;
  finalized_at: string | null;
  finalized_by: string | null;
  created_by: string | null;
  created_at: string;
}

export type AttachmentLinkRow = {
  id: string;
  organization_id: string;
  attachment_id: string;
  plan_id: string;
  plan_item_id: string | null;
  /** Null follows the file's current version. */
  pinned_version_id: string | null;
  source: FileLinkSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AttachmentAudienceTargetRow = {
  id: string;
  attachment_id: string;
  organization_id: string;
  team_id: string | null;
  position_id: string | null;
}

/** Bytes queued for removal (service role only). */
export type FileObjectRemovalRow = {
  id: number;
  bucket_id: string;
  object_path: string;
  reason: string;
  enqueued_at: string;
  attempts: number;
  leased_until: string | null;
  last_error: string | null;
  removed_at: string | null;
};

// ----------------------------------------------------------- RPC results --

export interface FileUploadIntentRpcResult {
  attachment: AttachmentRow;
  version: AttachmentVersionRow;
  replayed: boolean;
}

export type FileFinalizeOutcome = 'ready' | 'not_uploaded' | 'failed' | 'expired';

export interface FileFinalizeRpcResult {
  outcome: FileFinalizeOutcome;
  reason?: FileFailureReason | null;
  replayed: boolean;
  attachment: AttachmentRow;
  version: AttachmentVersionRow;
}

export interface FileSaveRpcResult {
  attachment: AttachmentRow;
  replayed?: boolean;
}

export interface FileAbandonRpcResult {
  attachment_removed: boolean;
}

// ------------------------------------------------------------ API shapes --

export interface FileOwnerRef {
  kind: FileOwnerKind;
  id: string;
}

/** One version as a client sees it (document bodies are fetched separately). */
export interface FileVersionSummary {
  id: string;
  version_number: number | null;
  status: FileVersionStatus;
  filename: string;
  mime_type: string;
  size_bytes: number | null;
  declared_size: number;
  failure_reason: FileFailureReason | null;
  upload_expires_at: string | null;
  created_at: string;
  created_by: string | null;
  finalized_at: string | null;
  is_current: boolean;
}

export interface FileAudienceTarget {
  team_id: string | null;
  position_id: string | null;
}

export interface FileSummary {
  id: string;
  owner: FileOwnerRef;
  plan_id: string | null;
  song_id: string | null;
  kind: FileKind;
  title: string;
  category: FileCategory;
  audience: FileAudience;
  audience_targets: FileAudienceTarget[];
  external_url: string | null;
  /** Null until an upload is finalized (only writers see such a file). */
  current_version: FileVersionSummary | null;
  /** Writers only: the caller's and others' unfinished or failed uploads. */
  pending_versions: FileVersionSummary[];
  revision: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}

export interface FileLinkSummary {
  id: string;
  attachment_id: string;
  plan_id: string;
  plan_item_id: string | null;
  pinned_version_id: string | null;
  source: FileLinkSource;
  created_at: string;
}

export interface FileDetail extends FileSummary {
  /** Every version the caller may read (writers: all; readers: current and pinned). */
  versions: FileVersionSummary[];
  /** Plan references the caller may see. */
  links: FileLinkSummary[];
}

export interface ParentFiles {
  owner: FileOwnerRef;
  files: FileSummary[];
  can_add: boolean;
}

/** How a file reaches a plan. */
export type PlanFileSource = 'plan' | 'item' | 'song' | 'arrangement' | 'link';

export interface PlanFileEntry {
  file: FileSummary;
  source: PlanFileSource;
  /** The item it is shown under (null: the plan itself). */
  plan_item_id: string | null;
  link: FileLinkSummary | null;
  /** The version this plan uses: the pinned one, else the current one. */
  version: FileVersionSummary | null;
  /** A pinned link whose file has a newer current version. */
  newer_version_available: boolean;
}

export interface PlanFiles {
  plan_id: string;
  entries: PlanFileEntry[];
  can_edit: boolean;
}

/** Where to PUT the bytes: one exact path, valid until `expires_at`. */
export interface FileUploadTarget {
  bucket: 'attachments';
  path: string;
  token: string;
  signed_url: string;
  expires_at: string;
}

export interface FileUploadIntent {
  file: FileSummary;
  version: FileVersionSummary;
  /** Null on a replay whose bytes are already stored: finalize instead. */
  upload: FileUploadTarget | null;
  replayed: boolean;
}

export interface FileFinalizeResult {
  outcome: FileFinalizeOutcome;
  reason: FileFailureReason | null;
  replayed: boolean;
  file: FileSummary;
  version: FileVersionSummary;
}

export interface FileDownload {
  kind: 'signed_url' | 'external';
  url: string;
  /** Signed URLs stop working after this; ask again (access is rechecked). */
  expires_at: string | null;
  filename: string;
  version: FileVersionSummary | null;
}

export interface FileDocument {
  file: FileSummary;
  version: FileVersionSummary;
  body: string;
}
