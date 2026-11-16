import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import {
  accessProblemOf,
  BLOCKED_ACCOUNT_MESSAGE,
  errorMessage,
  isApiErrorCode,
  isBlockedAccountError,
  NETWORK_ERROR_MESSAGE,
} from './errors';

describe('accessProblemOf', () => {
  it('recognises the two sign-in refusals', () => {
    expect(accessProblemOf(new ApiError(403, 'x', 'mfa_required'))).toBe('mfa_required');
    expect(accessProblemOf(new ApiError(403, 'x', 'not_platform_admin'))).toBe('not_platform_admin');
  });

  it('ignores other errors', () => {
    expect(accessProblemOf(new ApiError(403, 'x', 'forbidden'))).toBeNull();
    expect(accessProblemOf(new ApiError(409, 'x', 'mfa_required'))).toBeNull();
    expect(accessProblemOf(new Error('mfa_required'))).toBeNull();
  });
});

describe('errorMessage', () => {
  it('shows the server message', () => {
    expect(errorMessage(new ApiError(409, 'That URL slug is already taken', 'slug_taken'))).toBe(
      'That URL slug is already taken',
    );
  });

  it('explains a failed fetch', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('falls back for unknown values', () => {
    expect(errorMessage('nope', 'Fallback')).toBe('Fallback');
    expect(errorMessage(new ApiError(500, '  '), 'Fallback')).toBe('Fallback');
  });
});

describe('isApiErrorCode', () => {
  it('matches only API errors with that code', () => {
    expect(isApiErrorCode(new ApiError(409, 'x', 'slug_taken'), 'slug_taken')).toBe(true);
    expect(isApiErrorCode(new Error('slug_taken'), 'slug_taken')).toBe(false);
  });
});

describe('blocked accounts', () => {
  it('explains a banned sign-in and a blocked API session the same way', () => {
    const banned = Object.assign(new Error('User is banned'), { code: 'user_banned' });
    expect(isBlockedAccountError(banned)).toBe(true);
    expect(errorMessage(banned)).toBe(BLOCKED_ACCOUNT_MESSAGE);
    expect(errorMessage(new ApiError(401, 'This account is blocked', 'account_blocked'))).toBe(BLOCKED_ACCOUNT_MESSAGE);
    expect(isBlockedAccountError(new ApiError(401, 'x', 'unauthorized'))).toBe(false);
    expect(isBlockedAccountError(new Error('User is banned'))).toBe(false);
  });
});
