/**
 * F14: builds the rehearsal manifest and the rules every client follows to
 * play it, so web and native agree on order, tracks, rights and offline
 * status. The API builds the manifest from rows the caller could read
 * through RLS; nothing here grants access.
 */
import type { PlanDetail, PlanItemDetail } from '../types/domain.js';
import type { FileSummary, FileVersionSummary, PlanFileEntry } from '../types/files.js';
import type {
  OfflineEntryStatus,
  OfflinePackEntry,
  OfflinePackExclusion,
  OfflinePackRecord,
  OfflinePackStatus,
  RehearsalChart,
  RehearsalManifest,
  RehearsalManifestItem,
  RehearsalMaterial,
  RehearsalMaterialSource,
  RehearsalMediaRef,
  RehearsalPlayback,
  RehearsalPlaybackRate,
  RehearsalRepeatMode,
  RehearsalTrack,
} from '../types/rehearsal.js';
import { renderChartContext, resolvePlanItemChartContext } from './chart-context.js';

/** Re-read the manifest after this long (rights and versions may change). */
export const REHEARSAL_MANIFEST_TTL_SECONDS = 600;
/** Orders longer than this are cut (and say so). */
export const REHEARSAL_MANIFEST_MAX_ITEMS = 300;
/** An offline pack must see a fresh manifest within this long to stay current. */
export const OFFLINE_PACK_RECHECK_SECONDS = 24 * 60 * 60;
/** Default pack size budget; a device may ask for less. */
export const OFFLINE_PACK_DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

const isAudioLike = (mime: string | null): 'audio' | 'video' | null => {
  if (!mime) return null;
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
};

/** How a file is presented, from its kind, type and category. */
export const rehearsalPlaybackFor = (file: Pick<FileSummary, 'kind' | 'category'>, mimeType: string | null): RehearsalPlayback => {
  if (file.kind === 'link') return file.category === 'audio' || file.category === 'video' ? 'external' : 'link';
  if (file.kind === 'document') return 'document';
  return isAudioLike(mimeType) ?? 'view';
};

/**
 * One material as this plan uses it. `version` is the version the plan uses
 * (pinned or current); a file the caller cannot read never reaches here.
 */
export const toRehearsalMaterial = (
  file: FileSummary,
  version: FileVersionSummary | null,
  source: RehearsalMaterialSource,
  pinned: boolean,
  newerVersionAvailable: boolean,
): RehearsalMaterial | null => {
  if (file.kind !== 'link' && (!version || version.status !== 'ready')) return null;
  const mimeType = file.kind === 'link' ? null : (version?.mime_type ?? null);
  const playback = rehearsalPlaybackFor(file, mimeType);
  const upload = file.kind === 'upload';
  const download = upload && file.playback_rights === 'download';
  const size = version?.size_bytes ?? null;
  return {
    file_id: file.id,
    version_id: file.kind === 'link' ? null : (version?.id ?? null),
    version_number: file.kind === 'link' ? null : (version?.version_number ?? null),
    title: file.title,
    filename: file.kind === 'link' ? null : (version?.filename ?? null),
    kind: file.kind,
    category: file.category,
    mime_type: mimeType,
    size_bytes: file.kind === 'link' ? null : size,
    source,
    external_url: file.kind === 'link' ? file.external_url : null,
    playback,
    rights: {
      stream: upload && (playback === 'audio' || playback === 'video'),
      download,
      offline: download && size !== null,
    },
    playback_rights: file.playback_rights,
    pinned,
    newer_version_available: newerVersionAvailable,
  };
};

/** Most specific first: this item's own files, then what it links, its media, arrangement, song. */
const SOURCE_RANK: Record<RehearsalMaterialSource, number> = {
  item: 0,
  link: 1,
  media: 2,
  arrangement: 3,
  song: 4,
  plan: 5,
};
const PLAYBACK_RANK: Record<RehearsalPlayback, number> = {
  audio: 0,
  video: 1,
  external: 2,
  view: 3,
  document: 4,
  link: 5,
};

export const sortRehearsalMaterials = (materials: RehearsalMaterial[]): RehearsalMaterial[] =>
  [...materials].sort(
    (a, b) =>
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      PLAYBACK_RANK[a.playback] - PLAYBACK_RANK[b.playback] ||
      a.title.localeCompare(b.title),
  );

/**
 * The material the player plays for an item: the most specific playable
 * audio, else video, else an external audio/video link.
 */
export const selectRehearsalTrack = (materials: RehearsalMaterial[]): RehearsalMaterial | null => {
  const playable = materials.filter((material) => material.rights.stream || material.playback === 'external');
  return (
    [...playable].sort(
      (a, b) => PLAYBACK_RANK[a.playback] - PLAYBACK_RANK[b.playback] || SOURCE_RANK[a.source] - SOURCE_RANK[b.source],
    )[0] ?? null
  );
};

const chartFor = (item: PlanItemDetail): RehearsalChart | null => {
  if (item.item_type !== 'song' || !item.song) return null;
  const context = resolvePlanItemChartContext(item);
  if (context.status === 'unavailable') {
    return {
      status: 'arrangement_missing',
      key: null,
      source_key: null,
      key_from_plan: false,
      sequence: [],
      sequence_from_plan: false,
      chordpro: null,
    };
  }
  const rendered = renderChartContext(context);
  const base = {
    source_key: context.sourceKey,
    key_from_plan: context.keyFromPlan,
    sequence: [...context.sequence],
    sequence_from_plan: context.sequenceFromPlan,
  };
  if (rendered.status === 'unavailable') {
    // Without a chart, the label is the key the item is played in; with an
    // unreadable key, no key is claimed for chords that are not shown.
    return { ...base, status: rendered.reason, key: rendered.reason === 'no_chart' ? context.displayKey : null, chordpro: null };
  }
  return { ...base, status: 'ready', key: rendered.key ?? context.displayKey, chordpro: rendered.chordpro };
};

export interface BuildRehearsalManifestInput {
  plan: Pick<PlanDetail, 'id' | 'title' | 'service_date' | 'content_revision' | 'items'>;
  /** `GET /plans/:id/files` entries (already filtered to what the caller may read). */
  planFiles: PlanFileEntry[];
  /** Files owned by the media bundles the plan's items link (caller-readable only). */
  mediaFiles: FileSummary[];
  /** The bundles those items link. */
  media: RehearsalMediaRef[];
  now?: Date;
}

/**
 * The plan's items in order with what each may play and read. Plan-level
 * files go in `plan_materials`. Pinned versions are honoured as the plan
 * files view resolved them; media files use their current version.
 */
export const buildRehearsalManifest = ({
  plan,
  planFiles,
  mediaFiles,
  media,
  now = new Date(),
}: BuildRehearsalManifestInput): RehearsalManifest => {
  const ordered = [...plan.items].sort((a, b) => a.sort_order - b.sort_order);
  const truncated = ordered.length > REHEARSAL_MANIFEST_MAX_ITEMS;
  const items = ordered.slice(0, REHEARSAL_MANIFEST_MAX_ITEMS);
  const mediaById = new Map(media.map((bundle) => [bundle.id, bundle]));

  const byItem = new Map<string, RehearsalMaterial[]>();
  const planMaterials: RehearsalMaterial[] = [];
  for (const entry of planFiles) {
    // Writers still see archived files on the Files tab; rehearsal does not.
    if (entry.file.archived_at && !entry.link?.pinned_version_id) continue;
    const material = toRehearsalMaterial(
      entry.file,
      entry.version,
      entry.source,
      Boolean(entry.link?.pinned_version_id),
      entry.newer_version_available,
    );
    if (!material) continue;
    if (entry.plan_item_id) {
      const list = byItem.get(entry.plan_item_id) ?? [];
      list.push(material);
      byItem.set(entry.plan_item_id, list);
    } else {
      planMaterials.push(material);
    }
  }

  const manifestItems: RehearsalManifestItem[] = items.map((item, position) => {
    const bundle = item.item_type === 'item' && item.media_id ? (mediaById.get(item.media_id) ?? null) : null;
    const fromMedia = bundle
      ? mediaFiles
          .filter((file) => file.owner.kind === 'media' && file.owner.id === bundle.id && !file.archived_at)
          .map((file) => toRehearsalMaterial(file, file.current_version, 'media', false, false))
          .filter((material): material is RehearsalMaterial => material !== null)
      : [];
    const materials = sortRehearsalMaterials([...(byItem.get(item.id) ?? []), ...fromMedia]);
    const arrangement = item.arrangement ?? item.default_arrangement ?? null;
    return {
      item_id: item.id,
      position,
      item_type: item.item_type,
      title: item.title,
      length_seconds: item.length_seconds,
      service_segment: item.service_segment,
      song: item.song ? { id: item.song.id, title: item.song.title, author: item.song.author } : null,
      arrangement: item.item_type === 'song' && arrangement ? { id: arrangement.id, name: arrangement.name } : null,
      tempo_bpm: item.item_type === 'song' ? (arrangement?.bpm ?? item.song?.default_bpm ?? null) : null,
      chart: chartFor(item),
      media: bundle,
      materials,
      track_file_id: selectRehearsalTrack(materials)?.file_id ?? null,
    };
  });

  return {
    plan_id: plan.id,
    plan_title: plan.title,
    service_date: plan.service_date,
    plan_revision: plan.content_revision,
    generated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + REHEARSAL_MANIFEST_TTL_SECONDS * 1000).toISOString(),
    items: manifestItems,
    plan_materials: sortRehearsalMaterials(planMaterials),
    truncated,
  };
};

export const isRehearsalManifestExpired = (manifest: Pick<RehearsalManifest, 'expires_at'>, now: Date = new Date()): boolean =>
  now.getTime() >= new Date(manifest.expires_at).getTime();

// --------------------------------------------------------------- player --

/**
 * The player's stops in plan order: each item with a playable material. A
 * reader may choose another playable material of the same item instead of
 * the default (`choices`, by item id).
 */
export const rehearsalPlaylist = (
  manifest: Pick<RehearsalManifest, 'items'>,
  choices: Readonly<Record<string, string>> = {},
): RehearsalTrack[] =>
  manifest.items.flatMap((item) => {
    const chosen = choices[item.item_id];
    const material =
      (chosen && item.materials.find((candidate) => candidate.file_id === chosen && isPlayable(candidate))) ||
      item.materials.find((candidate) => candidate.file_id === item.track_file_id);
    return material ? [{ item_id: item.item_id, position: item.position, title: item.title, material }] : [];
  });

export const isPlayable = (material: RehearsalMaterial): boolean =>
  material.rights.stream || material.playback === 'external';

/**
 * The next stop for previous/next and for "this track ended". Returns null at
 * the end (or start) unless repeating the whole list; `one` repeats only when
 * a track ends, while next/previous still move.
 */
export const nextRehearsalIndex = (
  count: number,
  current: number,
  direction: 1 | -1,
  repeat: RehearsalRepeatMode,
  reason: 'ended' | 'user',
): number | null => {
  if (count <= 0) return null;
  if (reason === 'ended' && repeat === 'one') return current;
  const next = current + direction;
  if (next >= 0 && next < count) return next;
  if (repeat === 'all') return (next + count) % count;
  return null;
};

// -------------------------------------------------------- practice speed --

/**
 * The speeds every client offers, slowest first. All fit the narrowest
 * engine (Android Media3 0.1–2, AVPlayer 0–2, browsers 0.0625–16).
 */
export const REHEARSAL_PLAYBACK_RATES: readonly RehearsalPlaybackRate[] = [0.5, 0.75, 0.9, 1, 1.1, 1.25];
export const DEFAULT_REHEARSAL_PLAYBACK_RATE: RehearsalPlaybackRate = 1;

export const isRehearsalPlaybackRate = (value: unknown): value is RehearsalPlaybackRate =>
  typeof value === 'number' && (REHEARSAL_PLAYBACK_RATES as readonly number[]).includes(value);

/**
 * The tempo a musician hears at a practice speed, rounded to whole beats, or
 * null when the item has no tempo. The chart key is unchanged at any speed.
 */
export const rehearsalTempoAtRate = (bpm: number | null, rate: RehearsalPlaybackRate): number | null =>
  bpm && bpm > 0 ? Math.round(bpm * rate) : null;

/** A track's playable stream: inline audio/video, never an external link. */
export const isInlineTrack = (track: RehearsalTrack): boolean =>
  track.material.rights.stream && (track.material.playback === 'audio' || track.material.playback === 'video');

// -------------------------------------------------------------- offline --

/** One pack per signed-in user, organization and plan. */
export const offlinePackKey = (userId: string, organizationId: string, planId: string): string =>
  `rehearsal-pack:${userId}:${organizationId}:${planId}`;

/** Every pack that must be deleted when this user signs out or loses the organization. */
export const offlinePackKeysToRemove = (
  records: ReadonlyArray<Pick<OfflinePackRecord, 'key' | 'user_id' | 'organization_id'>>,
  keep: { userId: string | null; organizationIds: readonly string[] },
): string[] =>
  records
    .filter((record) => record.user_id !== keep.userId || !keep.organizationIds.includes(record.organization_id))
    .map((record) => record.key);

export interface OfflinePackSelection {
  entries: OfflinePackEntry[];
  excluded: OfflinePackExclusion[];
  total_bytes: number;
}

/**
 * What an explicit offline download may contain: downloadable uploads only,
 * in plan order, until the size budget is used. Stream-only files, links and
 * documents are listed as excluded with the reason; nothing is implied.
 */
export const selectOfflinePack = (
  manifest: Pick<RehearsalManifest, 'items' | 'plan_materials'>,
  maxBytes: number,
): OfflinePackSelection => {
  const entries: OfflinePackEntry[] = [];
  const excluded: OfflinePackExclusion[] = [];
  const seen = new Set<string>();
  let total = 0;
  const consider = (itemId: string | null, material: RehearsalMaterial): void => {
    const key = `${material.file_id}:${material.version_id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const exclude = (reason: OfflinePackExclusion['reason']): void => {
      excluded.push({ item_id: itemId, file_id: material.file_id, title: material.title, reason });
    };
    if (material.kind === 'link') return exclude('external_link');
    if (material.kind === 'document') return exclude('document');
    if (material.playback_rights === 'stream_only' || !material.rights.download) return exclude('stream_only');
    if (!material.rights.offline || material.size_bytes === null || !material.version_id) return exclude('size_unknown');
    if (total + material.size_bytes > maxBytes) return exclude('pack_limit');
    total += material.size_bytes;
    entries.push({
      item_id: itemId,
      file_id: material.file_id,
      version_id: material.version_id,
      version_number: material.version_number,
      filename: material.filename ?? material.title,
      mime_type: material.mime_type ?? 'application/octet-stream',
      size_bytes: material.size_bytes,
    });
  };
  for (const item of manifest.items) for (const material of item.materials) consider(item.item_id, material);
  for (const material of manifest.plan_materials) consider(null, material);
  return { entries, excluded, total_bytes: total };
};

/**
 * Compares what a device holds with a fresh manifest (online) or with the
 * clock alone (offline: pass `manifest: null`). Offline, entries keep their
 * downloaded status but `needs_recheck` turns true once `recheck_by` passes;
 * rights cannot be rechecked without the network and already downloaded
 * bytes cannot be revoked remotely.
 */
export const offlinePackStatus = (
  record: OfflinePackRecord,
  manifest: Pick<RehearsalManifest, 'items' | 'plan_materials'> | null,
  now: Date = new Date(),
): OfflinePackStatus => {
  const downloaded = (entry: OfflinePackRecord['entries'][number]): boolean => entry.downloaded_bytes >= entry.size_bytes;
  if (!manifest) {
    return {
      needs_recheck: now.getTime() >= new Date(record.recheck_by).getTime(),
      entries: record.entries.map((entry) => ({
        file_id: entry.file_id,
        version_id: entry.version_id,
        status: downloaded(entry) ? 'ready' : 'missing',
      })),
      new_file_ids: [],
    };
  }
  const allowed = selectOfflinePack(manifest, Number.MAX_SAFE_INTEGER).entries;
  const allowedByFile = new Map(allowed.map((entry) => [entry.file_id, entry]));
  const statuses = record.entries.map((entry) => {
    const current = allowedByFile.get(entry.file_id);
    let status: OfflineEntryStatus;
    if (!current) status = 'revoked';
    else if (current.version_id !== entry.version_id) status = 'stale';
    else status = downloaded(entry) ? 'ready' : 'missing';
    return { file_id: entry.file_id, version_id: entry.version_id, status };
  });
  const held = new Set(record.entries.map((entry) => entry.file_id));
  return {
    needs_recheck: false,
    entries: statuses,
    new_file_ids: allowed.filter((entry) => !held.has(entry.file_id)).map((entry) => entry.file_id),
  };
};

export const REHEARSAL_PLAYBACK_LABELS: Record<RehearsalPlayback, string> = {
  audio: 'Audio',
  video: 'Video',
  external: 'External player',
  view: 'File',
  document: 'Document',
  link: 'Web page',
};
