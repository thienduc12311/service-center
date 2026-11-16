import { describe, expect, it } from 'vitest';
import { ApiError } from '@service-center/shared';
import { accessProblemOf, errorMessage, isApiErrorCode, NETWORK_ERROR_MESSAGE } from './errors';

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
