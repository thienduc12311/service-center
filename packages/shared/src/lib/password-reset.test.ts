import { describe, expect, it } from 'vitest';
import { newPasswordProblem, passwordResetLinkFailed, passwordResetRedirectUrl } from './password-reset.js';

describe('passwordResetRedirectUrl', () => {
  it('points at the web reset page without a doubled slash', () => {
    expect(passwordResetRedirectUrl('https://app.graceaogchurch.com/')).toBe('https://app.graceaogchurch.com/reset-password');
    expect(passwordResetRedirectUrl('http://localhost:5173')).toBe('http://localhost:5173/reset-password');
  });
});

describe('newPasswordProblem', () => {
  it('needs 8 characters and a matching confirmation', () => {
    expect(newPasswordProblem('short', 'short')).toBe('tooShort');
    expect(newPasswordProblem('long enough', 'long enougH')).toBe('mismatch');
    expect(newPasswordProblem('long enough', 'long enough')).toBeNull();
  });
});

describe('passwordResetLinkFailed', () => {
  it('spots an expired or refused link in the hash or the query', () => {
    expect(passwordResetLinkFailed({ hash: '#error=access_denied&error_code=otp_expired', search: '' })).toBe(true);
    expect(passwordResetLinkFailed({ hash: '', search: '?error=access_denied' })).toBe(true);
    expect(passwordResetLinkFailed({ hash: '#access_token=x&type=recovery', search: '' })).toBe(false);
  });
});
