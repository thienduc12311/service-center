import { LocalizedError } from '@service-center/shared';
import { api } from './api';

/**
 * Direct Storage uploads (logo, pictures) refused because the church is out
 * of space come back as a generic storage error. When the church is full,
 * say that instead; any other failure is returned unchanged.
 */
export const explainStorageUploadError = async (error: unknown): Promise<unknown> => {
  try {
    const usage = await api.organizationStorage();
    if (usage.fraction_used >= 1) return new LocalizedError({ key: 'errors:codes.storage_quota_exceeded' });
  } catch (lookupError) {
    console.warn('Could not check storage usage after a failed upload', lookupError);
  }
  return error;
};
