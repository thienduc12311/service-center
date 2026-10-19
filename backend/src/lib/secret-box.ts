import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Server-side encryption for integration secrets (F17). AES-256-GCM with a
 * random 96-bit IV; the stored form is `v1.<iv>.<tag>.<ciphertext>` (base64url).
 * The key lives only in the API's environment, never in the database.
 */
const VERSION = 'v1';

const keyBytes = (key: string | undefined): Buffer | null => {
  if (!key) return null;
  const bytes = Buffer.from(key, 'base64');
  return bytes.length === 32 ? bytes : null;
};

export const secretBoxAvailable = (key: string | undefined = config.INTEGRATION_SECRET_KEY): boolean => keyBytes(key) !== null;

export const sealSecret = (plaintext: string, key: string | undefined = config.INTEGRATION_SECRET_KEY): string => {
  const bytes = keyBytes(key);
  if (!bytes) throw new Error('Integration secret key is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bytes, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
};

/** The plaintext, or null when the key is missing/rotated or the value was tampered with. */
export const openSecret = (sealed: string, key: string | undefined = config.INTEGRATION_SECRET_KEY): string | null => {
  const bytes = keyBytes(key);
  const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
  if (!bytes || version !== VERSION || !iv || !tag || !ciphertext || rest.length) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', bytes, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};
