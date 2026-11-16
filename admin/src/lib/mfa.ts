import type { Factor } from '@supabase/supabase-js';

/** Authenticator codes are six digits. */
export const TOTP_CODE_LENGTH = 6;

/** Digits only, at most six, so pasted "123 456" works. */
export const normalizeTotpCode = (text: string): string => text.replace(/\D/g, '').slice(0, TOTP_CODE_LENGTH);

export const isCompleteTotpCode = (code: string): boolean => new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(code);

/** Supabase returns the QR code as an SVG data URL; older servers sent bare SVG markup. */
export const qrCodeImageSource = (qrCode: string): string =>
  qrCode.startsWith('data:') ? qrCode : `data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`;

/** The factor fields the two-factor step reads. */
export type MfaFactor = Pick<Factor, 'id' | 'factor_type' | 'status'>;

/** The verified authenticator-app factor to challenge, if the account has one. */
export const verifiedTotpFactor = <T extends MfaFactor>(factors: readonly T[]): T | null =>
  factors.find((factor) => factor.factor_type === 'totp' && factor.status === 'verified') ?? null;

/** Leftovers of an enrollment that was never finished; removed before enrolling again. */
export const unverifiedFactorIds = (factors: readonly MfaFactor[]): string[] =>
  factors.filter((factor) => factor.status === 'unverified').map((factor) => factor.id);

/** The secret in groups of four, easier to type into an authenticator app. */
export const groupSecret = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim();
