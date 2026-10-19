/**
 * F14: the rehearsal manifest — a plan's permitted materials in order — and
 * the offline-pack contract built on it.
 *
 * Nothing here is a URL to bytes. A client asks `POST /files/:id/download`
 * for the exact version the manifest names when it is about to play or save
 * it, so access is rechecked at that moment, never inferred from having once
 * held a link.
 */
import type { PlanItemSegment, PlanItemType } from './database.js';
import type { FileCategory, FileKind, PlanFileSource } from './files.js';

/** What a reader may do with an uploaded file (writers choose; F14). */
export type FilePlaybackRights = 'download' | 'stream_only';

/** How a client presents one material. */
export type RehearsalPlayback =
  /** Played inline through a short-lived signed URL. */
  | 'audio'
  | 'video'
  /** An audio/video link that opens in its own player; never imported or licensed here. */
  | 'external'
  /** A chart, image, PDF or other file opened for reading. */
  | 'view'
  /** A text document (F13), fetched with `GET /files/:id/document`. */
  | 'document'
  /** A web page link. */
  | 'link';

export interface RehearsalRights {
  /** Playable inline (audio/video uploads). */
  stream: boolean;
  /** A reader may save a copy: an upload whose rights are `download`. */
  download: boolean;
  /** May go into an explicit offline pack (downloadable, size known). */
  offline: boolean;
}

/** Where a material comes from, most specific first in each item. */
export type RehearsalMaterialSource = PlanFileSource | 'media';

export interface RehearsalMaterial {
  file_id: string;
  /** The exact version this plan uses (pinned or current); null for links. */
  version_id: string | null;
  version_number: number | null;
  title: string;
  filename: string | null;
  kind: FileKind;
  category: FileCategory;
  mime_type: string | null;
  size_bytes: number | null;
  source: RehearsalMaterialSource;
  /** Links only: the address, opened by the reader's own browser or app. */
  external_url: string | null;
  playback: RehearsalPlayback;
  rights: RehearsalRights;
  playback_rights: FilePlaybackRights;
  /** True when a plan link pins this version. */
  pinned: boolean;
  newer_version_available: boolean;
}

export type RehearsalChartStatus =
  | 'ready'
  /** The arrangement has no chord chart. */
  | 'no_chart'
  /** The chart cannot be put in the service key (missing/unreadable key). */
  | 'key_unknown'
  /** The item names an arrangement that is not (or no longer) its song's. */
  | 'arrangement_missing';

/** The F11 chart context, already rendered in the service key. */
export interface RehearsalChart {
  status: RehearsalChartStatus;
  /** The key of the chords below (the service key when it could be applied). */
  key: string | null;
  /** The key the arrangement is written in. */
  source_key: string | null;
  key_from_plan: boolean;
  sequence: string[];
  sequence_from_plan: boolean;
  /** ChordPro in `key`; null unless `status` is `ready`. */
  chordpro: string | null;
}

export interface RehearsalMediaRef {
  id: string;
  title: string;
  creator: string | null;
  duration_seconds: number | null;
  /** Archived bundles stay readable where a plan already uses them. */
  archived: boolean;
}

export interface RehearsalManifestItem {
  item_id: string;
  /** Position in the plan's order (0-based, headers included). */
  position: number;
  item_type: PlanItemType;
  title: string;
  length_seconds: number;
  service_segment: PlanItemSegment;
  song: { id: string; title: string; author: string | null } | null;
  arrangement: { id: string; name: string } | null;
  /** The arrangement's tempo, else the song's default. */
  tempo_bpm: number | null;
  /** Song items only. */
  chart: RehearsalChart | null;
  media: RehearsalMediaRef | null;
  materials: RehearsalMaterial[];
  /** The material the player plays for this item, if any is playable. */
  track_file_id: string | null;
}

export interface RehearsalManifest {
  plan_id: string;
  plan_title: string;
  service_date: string;
  /** `plans.content_revision` the order was read at. */
  plan_revision: number;
  generated_at: string;
  /**
   * After this, ask for the manifest again before trusting it: rights,
   * versions and order are rechecked on every read.
   */
  expires_at: string;
  items: RehearsalManifestItem[];
  /** Plan-level files (not under an item), in the order they were added. */
  plan_materials: RehearsalMaterial[];
  /** True when the order was longer than the manifest's item limit. */
  truncated: boolean;
}

/** One stop of the player: an item with a playable material. */
export interface RehearsalTrack {
  item_id: string;
  position: number;
  title: string;
  material: RehearsalMaterial;
}

export type RehearsalRepeatMode = 'off' | 'all' | 'one';

// -------------------------------------------------------------- offline --

/** Why a material is not in an offline pack. */
export type OfflineExclusionReason =
  | 'stream_only'
  | 'external_link'
  | 'document'
  | 'size_unknown'
  | 'pack_limit'
  /** Access changed between the manifest read and issuing the download. */
  | 'unavailable';

export interface OfflinePackEntry {
  item_id: string | null;
  file_id: string;
  version_id: string;
  version_number: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/** A signed download for one pack entry (short-lived; ask again to renew). */
export interface OfflinePackDownload extends OfflinePackEntry {
  url: string;
  url_expires_at: string;
}

export interface OfflinePackExclusion {
  item_id: string | null;
  file_id: string;
  title: string;
  reason: OfflineExclusionReason;
}

/** What `POST /plans/:id/rehearsal-manifest/offline-pack` returns. */
export interface OfflinePackPlan {
  plan_id: string;
  plan_revision: number;
  created_at: string;
  /**
   * The device must recheck rights (a fresh manifest) before this time to
   * keep showing the pack as current; after it, content shows as stale.
   */
  recheck_by: string;
  total_bytes: number;
  max_bytes: number;
  entries: OfflinePackDownload[];
  excluded: OfflinePackExclusion[];
  /** The manifest the pack was built from (charts and order work offline). */
  manifest: RehearsalManifest;
}

/** What a device stores about a pack it downloaded (never the URLs). */
export interface OfflinePackRecord {
  /** `offlinePackKey(...)`: one pack per user, organization and plan. */
  key: string;
  user_id: string;
  organization_id: string;
  plan_id: string;
  plan_revision: number;
  created_at: string;
  recheck_by: string;
  entries: Array<OfflinePackEntry & { downloaded_bytes: number }>;
}

export type OfflineEntryStatus =
  /** Downloaded, complete, and the current manifest still names this version. */
  | 'ready'
  /** Downloaded, but the plan now uses another version. */
  | 'stale'
  /** Not (fully) downloaded. */
  | 'missing'
  /** The current manifest no longer allows it offline (or at all): delete it. */
  | 'revoked';

export interface OfflinePackStatus {
  /** True once `recheck_by` has passed without a fresh manifest. */
  needs_recheck: boolean;
  entries: Array<{ file_id: string; version_id: string; status: OfflineEntryStatus }>;
  /** Files the current manifest allows offline that the pack lacks. */
  new_file_ids: string[];
}
