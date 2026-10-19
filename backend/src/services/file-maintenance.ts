import { adminDb, unwrap } from '../lib/supabase.js';

/** What one maintenance run did. */
export interface FileMaintenanceResult {
  expired: number;
  removed: number;
  failed: number;
}

const BUCKET = 'attachments';

/**
 * Settles upload intents past their expiry and removes the bytes of failed,
 * expired and deleted versions. Service role only; the queue is filled by the
 * database (`attachment_object_removals`) so nothing here decides what may be
 * deleted. Removal is leased and retried, and removing an already missing
 * object counts as done.
 */
export const runFileMaintenance = async (limit = 100): Promise<FileMaintenanceResult> => {
  const expired = (await unwrap(adminDb.rpc('expire_file_uploads', { p_limit: limit }))) ?? 0;
  const claimed = (await unwrap(adminDb.rpc('claim_file_object_removals', { p_limit: limit }))) ?? [];
  if (!claimed.length) return { expired, removed: 0, failed: 0 };

  const removed: number[] = [];
  const failed: number[] = [];
  let lastError: string | null = null;
  const { error } = await adminDb.storage.from(BUCKET).remove(claimed.map((row) => row.object_path));
  if (error) {
    failed.push(...claimed.map((row) => row.id));
    // The Storage message names no file contents; keep it short.
    lastError = error.message.slice(0, 200);
  } else {
    removed.push(...claimed.map((row) => row.id));
  }
  await unwrap(adminDb.rpc('complete_file_object_removals', { p_removed: removed, p_failed: failed, p_error: lastError }));
  return { expired, removed: removed.length, failed: failed.length };
};

/** For scheduled runs: a Storage outage must not fail the delivery run it rides along with. */
export const runFileMaintenanceSafely = async (): Promise<FileMaintenanceResult | null> => {
  try {
    return await runFileMaintenance();
  } catch (error) {
    console.warn(`[files] maintenance failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
};
