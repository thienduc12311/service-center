/**
 * Storage sizes. Quotas are whole bytes on the wire and megabytes in forms;
 * a megabyte here is 1,048,576 bytes, the same unit `formatFileSize` shows
 * and the quota schema's 1 MB minimum uses.
 */
export const BYTES_PER_MEGABYTE = 1_048_576;

export const bytesToMegabytes = (bytes: number): number => bytes / BYTES_PER_MEGABYTE;

export const megabytesToBytes = (megabytes: number): number => Math.round(megabytes * BYTES_PER_MEGABYTE);

/** A positive number of megabytes typed into a field, or null when it isn't one. */
export const parseMegabytes = (text: string): number | null => {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** A byte count as a form value in megabytes: at most two decimals, no trailing zeros. */
export const megabytesFieldValue = (bytes: number): string => String(Math.round(bytesToMegabytes(bytes) * 100) / 100);

/** The quota range the API accepts: 1 MB to 1 TB. */
export const MIN_QUOTA_MEGABYTES = 1;
export const MAX_QUOTA_MEGABYTES = 1_048_576;

export type QuotaInputResult = { ok: true; bytes: number } | { ok: false; message: string };

/** A quota typed in megabytes, checked against the API's range with a readable message. */
export const quotaBytesFromInput = (text: string): QuotaInputResult => {
  const megabytes = parseMegabytes(text);
  if (megabytes === null) return { ok: false, message: 'Enter a size in MB, for example 500.' };
  if (megabytes < MIN_QUOTA_MEGABYTES) return { ok: false, message: 'The smallest quota is 1 MB.' };
  if (megabytes > MAX_QUOTA_MEGABYTES) return { ok: false, message: 'The largest quota is 1,048,576 MB (1 TB).' };
  return { ok: true, bytes: megabytesToBytes(megabytes) };
};
