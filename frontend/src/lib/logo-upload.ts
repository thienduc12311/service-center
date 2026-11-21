import { LocalizedError } from '@service-center/shared';

/** Image types the organization-logos bucket accepts (raster only). */
export const ALLOWED_LOGO_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const LOGO_FILE_ACCEPT = ALLOWED_LOGO_MIME_TYPES.join(',');

const unsupportedLogoType = (): LocalizedError => new LocalizedError({ key: 'errors:codes.logo_type_unsupported' });

/** Returns an error to show when `file` can't be a logo, or null when it can. */
export const validateLogoFile = (file: Pick<File, 'type'>): LocalizedError | null =>
  ALLOWED_LOGO_MIME_TYPES.includes(file.type) ? null : unsupportedLogoType();

interface StorageErrorLike {
  message?: unknown;
  statusCode?: unknown;
  status?: unknown;
}

/** Maps Storage's refusal of a disallowed MIME type to the same message as the client check. */
export const mapLogoUploadError = (error: unknown): unknown => {
  if (typeof error !== 'object' || error === null) return error;
  const { message, statusCode, status } = error as StorageErrorLike;
  const code = String(statusCode ?? status ?? '');
  const text = typeof message === 'string' ? message : '';
  if (code === '415' || /mime type|not supported|unsupported/i.test(text)) return unsupportedLogoType();
  return error;
};
