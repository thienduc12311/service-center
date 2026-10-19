import {
  FILE_DOWNLOAD_TTL_SECONDS,
  OFFLINE_PACK_DEFAULT_MAX_BYTES,
  OFFLINE_PACK_RECHECK_SECONDS,
  buildRehearsalManifest,
  selectOfflinePack,
  type OfflinePackDownload,
  type OfflinePackPlan,
  type OfflinePackRequestInput,
  type RehearsalManifest,
  type RehearsalMediaRef,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { createDownload, listMediaFiles, listPlanFiles, type FileCaller } from './files.js';
import { fetchPlanDetail } from './plans.js';

/**
 * F14: `GET /plans/:id/rehearsal-manifest`. Everything is read with the
 * caller's own client, so the plan order, the files (F13 RLS: audience,
 * prepared/released, pins, archive) and the media bundles are exactly what
 * this caller may see right now. The manifest names versions, never URLs.
 */
export const getRehearsalManifest = async (caller: FileCaller, planId: string, now: Date = new Date()): Promise<RehearsalManifest> => {
  const [plan, planFiles] = await Promise.all([
    fetchPlanDetail(caller.db, caller.orgId, planId),
    listPlanFiles(caller, planId),
  ]);
  const media = new Map<string, RehearsalMediaRef>();
  for (const item of plan.items) {
    if (item.item_type === 'item' && item.media) media.set(item.media.id, item.media);
  }
  const mediaFiles = await listMediaFiles(caller, [...media.keys()]);
  return buildRehearsalManifest({ plan, planFiles: planFiles.entries, mediaFiles, media: [...media.values()], now });
};

/**
 * F14 Pass C: what an explicit offline download may contain, each entry with
 * a short-lived URL issued with the caller's token (Storage rechecks the
 * audience). Stream-only files, links and documents are listed as excluded.
 * Nothing is stored server-side; the device keeps its own record.
 */
export const createOfflinePack = async (
  caller: FileCaller,
  planId: string,
  input: OfflinePackRequestInput,
  now: Date = new Date(),
): Promise<OfflinePackPlan> => {
  const manifest = await getRehearsalManifest(caller, planId, now);
  const maxBytes = input.max_bytes ?? OFFLINE_PACK_DEFAULT_MAX_BYTES;
  const selection = selectOfflinePack(manifest, maxBytes);
  const entries: OfflinePackDownload[] = [];
  const excluded = [...selection.excluded];
  for (const entry of selection.entries) {
    try {
      const download = await createDownload(caller, entry.file_id, { version_id: entry.version_id, disposition: 'attachment' });
      entries.push({
        ...entry,
        url: download.url,
        url_expires_at: download.expires_at ?? new Date(now.getTime() + FILE_DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
      });
    } catch (error) {
      // Access changed between the manifest read and the URL: leave it out.
      if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
        excluded.push({ item_id: entry.item_id, file_id: entry.file_id, title: entry.filename, reason: 'unavailable' });
        continue;
      }
      throw error;
    }
  }
  return {
    plan_id: planId,
    plan_revision: manifest.plan_revision,
    created_at: now.toISOString(),
    recheck_by: new Date(now.getTime() + OFFLINE_PACK_RECHECK_SECONDS * 1000).toISOString(),
    total_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    max_bytes: maxBytes,
    entries,
    excluded,
    manifest,
  };
};
