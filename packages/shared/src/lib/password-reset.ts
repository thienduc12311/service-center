/**
 * Password reset, shared by the web app and the mobile app. Supabase Auth
 * sends the email; its link opens the web app's `/reset-password` page,
 * which works from any device without app deep links.
 */

/** Same minimum as sign-up. */
export const MIN_PASSWORD_LENGTH = 8;

/** Where the reset email's link lands: the web app's reset page. */
export const PASSWORD_RESET_PATH = '/reset-password';

/** `appUrl` is the web app's origin, e.g. `https://app.graceaogchurch.com`. */
export const passwordResetRedirectUrl = (appUrl: string): string =>
  `${appUrl.replace(/\/+$/, '')}${PASSWORD_RESET_PATH}`;

export type NewPasswordProblem = 'tooShort' | 'mismatch';

/** What is wrong with a new password and its confirmation, or null when it can be saved. */
export const newPasswordProblem = (password: string, confirmation: string): NewPasswordProblem | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (password !== confirmation) return 'mismatch';
  return null;
};

/**
 * A reset link that failed before the app could use it comes back with the
 * error in the URL (`#error_code=otp_expired` or `?error=access_denied`).
 */
export const passwordResetLinkFailed = (location: { hash: string; search: string }): boolean => {
  const params = new URLSearchParams(`${location.search.replace(/^\?/, '')}&${location.hash.replace(/^#/, '')}`);
  return params.has('error') || params.has('error_code');
};
