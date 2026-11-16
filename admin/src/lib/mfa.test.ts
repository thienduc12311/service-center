import { describe, expect, it } from 'vitest';
import {
  groupSecret,
  isCompleteTotpCode,
  normalizeTotpCode,
  qrCodeImageSource,
  unverifiedFactorIds,
  verifiedTotpFactor,
  type MfaFactor,
} from './mfa';

const factors: MfaFactor[] = [
  { id: 'phone', factor_type: 'phone', status: 'verified' },
  { id: 'old', factor_type: 'totp', status: 'unverified' },
  { id: 'app', factor_type: 'totp', status: 'verified' },
];

describe('two-factor helpers', () => {
  it('normalizes typed and pasted codes', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
    expect(normalizeTotpCode('12-34-56-78')).toBe('123456');
    expect(isCompleteTotpCode('123456')).toBe(true);
    expect(isCompleteTotpCode('12345')).toBe(false);
  });

  it('keeps data URLs and wraps bare SVG', () => {
    expect(qrCodeImageSource('data:image/svg+xml;utf-8,<svg/>')).toBe('data:image/svg+xml;utf-8,<svg/>');
    expect(qrCodeImageSource('<svg/>')).toBe('data:image/svg+xml;utf-8,%3Csvg%2F%3E');
  });

  it('finds the verified authenticator factor and the leftovers', () => {
    expect(verifiedTotpFactor(factors)?.id).toBe('app');
    expect(verifiedTotpFactor(factors.slice(0, 2))).toBeNull();
    expect(unverifiedFactorIds(factors)).toEqual(['old']);
  });

  it('groups the secret', () => {
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
  });
});
